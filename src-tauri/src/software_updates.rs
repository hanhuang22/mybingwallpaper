use std::{future::Future, time::Duration};

use semver::Version;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::{sync::watch, time};

use crate::SoftwareUpdateProgress;

pub const CHECK_TIMEOUT: Duration = Duration::from_secs(8);
const PEER_GRACE: Duration = Duration::from_millis(1500);
const DOWNLOAD_STALL_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TOTAL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Source {
    Gitee,
    GitHub,
}

impl Source {
    fn name(self) -> &'static str {
        match self {
            Self::Gitee => "Gitee",
            Self::GitHub => "GitHub",
        }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Self::Gitee => "https://gitee.com/Hyman25/mybingwallpaper/raw/updater/latest.json",
            Self::GitHub => {
                "https://github.com/hanhuang22/mybingwallpaper/releases/latest/download/latest.json"
            }
        }
    }

    fn other(self) -> Self {
        match self {
            Self::Gitee => Self::GitHub,
            Self::GitHub => Self::Gitee,
        }
    }
}

#[derive(Clone, Debug)]
struct Candidate<T> {
    source: Source,
    version: Version,
    payload: T,
}

pub struct CheckedUpdates {
    pub version: String,
    candidates: Vec<Candidate<Update>>,
}

async fn check_source<R: Runtime>(
    app: &AppHandle<R>,
    source: Source,
) -> Result<Option<Candidate<Update>>, String> {
    // A separate updater per endpoint prevents a valid but stale mirror from
    // terminating the plugin's normal sequential endpoint search.
    let updater = app
        .updater_builder()
        .endpoints(vec![source
            .endpoint()
            .parse()
            .map_err(|error| format!("{error}"))?])
        .map_err(|error| error.to_string())?
        .timeout(CHECK_TIMEOUT)
        .header("Cache-Control", "no-cache")
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    let Some(mut update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    if update.download_url.scheme() != "https" {
        return Err("更新包必须通过 HTTPS 下载".into());
    }
    // The no-cache header is only for mutable manifests, not immutable packages.
    update.headers.remove("Cache-Control");
    let version = Version::parse(&update.version).map_err(|error| error.to_string())?;
    update.timeout = Some(DOWNLOAD_TOTAL_TIMEOUT);
    Ok(Some(Candidate {
        source,
        version,
        payload: update,
    }))
}

async fn check_pair<T, G, H>(
    gitee: G,
    github: H,
    timeout: Duration,
    grace: Duration,
) -> Result<Vec<Candidate<T>>, String>
where
    G: Future<Output = Result<Option<Candidate<T>>, String>>,
    H: Future<Output = Result<Option<Candidate<T>>, String>>,
{
    // Both absolute deadlines start together, not one after the other.
    let gitee = time::timeout(timeout, gitee);
    let github = time::timeout(timeout, github);
    tokio::pin!(gitee, github);
    let (first_source, first) = tokio::select! {
        result = &mut gitee => (Source::Gitee, result),
        result = &mut github => (Source::GitHub, result),
    };
    // Give the peer a brief chance to report a newer version, but do not wait
    // for an unreachable mirror when an installable update is already known.
    // An old/no-update response must not shorten the other source's deadline.
    let wait = if matches!(&first, Ok(Ok(Some(_)))) {
        grace
    } else {
        timeout
    };
    let peer = if first_source == Source::Gitee {
        time::timeout(wait, &mut github).await
    } else {
        time::timeout(wait, &mut gitee).await
    };
    let peer = peer.unwrap_or_else(|error| Err(error));
    let mut candidates = Vec::new();
    let mut successful = 0;
    let mut failures = Vec::new();
    for (source, result) in [(first_source, first), (first_source.other(), peer)] {
        match result {
            Ok(Ok(update)) => {
                successful += 1;
                if let Some(update) = update {
                    candidates.push(update);
                }
            }
            Ok(Err(error)) => failures.push(format!("{}：{error}", source.name())),
            Err(_) => failures.push(format!("{}：检查超时", source.name())),
        }
    }
    if successful == 0 {
        return Err(failures.join("；"));
    }
    // Stable sorting preserves the first response as the preferred download
    // source when both sources announce the same version.
    candidates.sort_by(|a, b| b.version.cmp(&a.version));
    Ok(candidates)
}

pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Option<CheckedUpdates>, String> {
    let candidates = check_pair(
        check_source(app, Source::Gitee),
        check_source(app, Source::GitHub),
        CHECK_TIMEOUT,
        PEER_GRACE,
    )
    .await?;
    let Some(first) = candidates.first() else {
        return Ok(None);
    };
    let version = first.version.to_string();
    Ok(Some(CheckedUpdates {
        version,
        candidates,
    }))
}

#[derive(Debug, PartialEq, Eq)]
struct UpdateIdentity {
    version: Version,
    target: String,
    signature: String,
}

impl UpdateIdentity {
    fn from_candidate(candidate: &Candidate<Update>) -> Self {
        Self {
            version: candidate.version.clone(),
            target: candidate.payload.target.clone(),
            signature: candidate.payload.signature.trim().to_owned(),
        }
    }

    fn ensure_matches(&self, other: &Self) -> Result<(), String> {
        if self == other {
            Ok(())
        } else {
            Err("镜像版本或更新包签名不一致，请稍后重新检查更新".into())
        }
    }
}

async fn try_sources<T, F, Fut>(first: Source, mut attempt: F) -> Result<T, String>
where
    F: FnMut(Source) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let mut failures = Vec::new();
    for source in [first, first.other()] {
        match attempt(source).await {
            Ok(result) => return Ok(result),
            Err(error) => failures.push(format!("{}：{error}", source.name())),
        }
    }
    Err(format!("更新下载或签名校验失败：{}", failures.join("；")))
}

async fn with_download_deadlines<T>(
    download: impl Future<Output = Result<T, String>>,
    mut progress: watch::Receiver<()>,
    stall_timeout: Duration,
    total_timeout: Duration,
) -> Result<T, String> {
    let download = time::timeout(total_timeout, download);
    let idle = time::sleep(stall_timeout);
    tokio::pin!(download, idle);
    let mut progress_open = true;
    loop {
        tokio::select! {
            result = &mut download => return result.map_err(|_| "下载超过最长等待时间".to_string())?,
            _ = &mut idle => return Err("下载长时间无进展".into()),
            changed = progress.changed(), if progress_open => {
                if changed.is_ok() {
                    idle.as_mut().reset(time::Instant::now() + stall_timeout);
                } else {
                    progress_open = false;
                }
            }
        }
    }
}

pub async fn download<R: Runtime>(
    app: &AppHandle<R>,
    checked: CheckedUpdates,
) -> Result<(Update, Vec<u8>), String> {
    let first = checked.candidates.first().ok_or("没有可用的更新包")?;
    let identity = UpdateIdentity::from_candidate(first);
    try_sources(first.source, |source| {
        let cached = checked
            .candidates
            .iter()
            .find(|candidate| {
                candidate.source == source && UpdateIdentity::from_candidate(candidate) == identity
            })
            .cloned();
        let identity = &identity;
        async move {
            let candidate = if let Some(candidate) = cached {
                candidate
            } else {
                // A timed-out or not-yet-synchronized peer can recover while
                // the first source downloads. Refresh it once, only if needed.
                time::timeout(CHECK_TIMEOUT, check_source(app, source))
                    .await
                    .map_err(|_| "镜像检查超时".to_string())??
                    .ok_or("镜像暂未提供此更新")?
            };
            identity.ensure_matches(&UpdateIdentity::from_candidate(&candidate))?;
            let _ = app.emit(
                "software-update-progress",
                SoftwareUpdateProgress {
                    source: source.name(),
                    downloaded: 0,
                    total: None,
                },
            );
            let (heartbeat, progress) = watch::channel(());
            let mut downloaded = 0_u64;
            let download = candidate.payload.download(
                move |chunk, total| {
                    downloaded = downloaded.saturating_add(chunk as u64);
                    if chunk > 0 {
                        heartbeat.send_replace(());
                    }
                    let _ = app.emit(
                        "software-update-progress",
                        SoftwareUpdateProgress {
                            source: source.name(),
                            downloaded,
                            total,
                        },
                    );
                },
                || {},
            );
            // The plugin still verifies every downloaded byte against the
            // embedded public key. A failed signature can never reach install.
            let bytes = with_download_deadlines(
                async move { download.await.map_err(|error| error.to_string()) },
                progress,
                DOWNLOAD_STALL_TIMEOUT,
                DOWNLOAD_TOTAL_TIMEOUT,
            )
            .await?;
            Ok((candidate.payload, bytes))
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };

    fn candidate(source: Source, version: &str) -> Candidate<()> {
        Candidate {
            source,
            version: Version::parse(version).unwrap(),
            payload: (),
        }
    }

    async fn after<T>(duration: Duration, result: T) -> T {
        time::sleep(duration).await;
        result
    }

    #[test]
    fn source_registry_matches_the_shipped_configuration() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["plugins"]["updater"]["endpoints"],
            serde_json::json!([Source::Gitee.endpoint(), Source::GitHub.endpoint(),])
        );
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn a_fast_old_gitee_manifest_does_not_hide_a_later_github_update() {
        let updates = check_pair(
            async { Ok(None) },
            after(
                Duration::from_secs(3),
                Ok(Some(candidate(Source::GitHub, "1.3.0"))),
            ),
            CHECK_TIMEOUT,
            PEER_GRACE,
        )
        .await
        .unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].source, Source::GitHub);
        assert_eq!(updates[0].version.to_string(), "1.3.0");
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn newest_version_wins_even_if_an_older_update_arrives_first() {
        let updates = check_pair(
            async { Ok(Some(candidate(Source::Gitee, "1.3.0"))) },
            after(
                Duration::from_millis(500),
                Ok(Some(candidate(Source::GitHub, "1.4.0"))),
            ),
            CHECK_TIMEOUT,
            PEER_GRACE,
        )
        .await
        .unwrap();
        assert_eq!(updates[0].version.to_string(), "1.4.0");
        assert_eq!(updates[0].source, Source::GitHub);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn the_faster_mirror_is_preferred_for_the_same_version() {
        let updates = check_pair(
            after(
                Duration::from_millis(500),
                Ok(Some(candidate(Source::Gitee, "1.3.0"))),
            ),
            async { Ok(Some(candidate(Source::GitHub, "1.3.0"))) },
            CHECK_TIMEOUT,
            PEER_GRACE,
        )
        .await
        .unwrap();
        assert_eq!(updates[0].source, Source::GitHub);
        assert_eq!(updates[1].source, Source::Gitee);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn a_working_update_does_not_wait_for_a_hung_peer() {
        let started = time::Instant::now();
        let updates = check_pair(
            std::future::pending(),
            async { Ok(Some(candidate(Source::GitHub, "1.3.0"))) },
            CHECK_TIMEOUT,
            PEER_GRACE,
        )
        .await
        .unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(started.elapsed(), PEER_GRACE);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn invalid_json_or_an_unreachable_source_does_not_block_the_other_source() {
        let updates = check_pair(
            async { Err("invalid JSON".into()) },
            async { Ok(Some(candidate(Source::GitHub, "1.3.0"))) },
            CHECK_TIMEOUT,
            PEER_GRACE,
        )
        .await
        .unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].source, Source::GitHub);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn no_update_is_only_reported_after_both_checks_or_their_deadline() {
        let started = time::Instant::now();
        let updates = check_pair::<(), _, _>(
            async { Ok(None) },
            std::future::pending(),
            CHECK_TIMEOUT,
            PEER_GRACE,
        )
        .await
        .unwrap();
        assert!(updates.is_empty());
        assert_eq!(started.elapsed(), CHECK_TIMEOUT);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn two_unavailable_sources_fail_in_one_timeout_not_two() {
        let started = time::Instant::now();
        let error = check_pair::<(), _, _>(
            std::future::pending(),
            std::future::pending(),
            CHECK_TIMEOUT,
            PEER_GRACE,
        )
        .await
        .unwrap_err();
        assert!(error.contains("Gitee"));
        assert!(error.contains("GitHub"));
        assert_eq!(started.elapsed(), CHECK_TIMEOUT);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn a_successful_download_does_not_start_a_duplicate_download() {
        let attempts = Mutex::new(Vec::new());
        let bytes = try_sources(Source::GitHub, |source| {
            attempts.lock().unwrap().push(source);
            async { Ok(vec![1, 2, 3]) }
        })
        .await
        .unwrap();
        assert_eq!(bytes, vec![1, 2, 3]);
        assert_eq!(*attempts.lock().unwrap(), vec![Source::GitHub]);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn failed_or_invalidly_signed_downloads_switch_source_once() {
        for failure in [
            "HTTP 500",
            "connection reset",
            "signature verification failed",
        ] {
            let attempts = Mutex::new(Vec::new());
            let result = try_sources(Source::Gitee, |source| {
                attempts.lock().unwrap().push(source);
                async move {
                    if source == Source::Gitee {
                        Err(failure.to_owned())
                    } else {
                        Ok("verified bytes")
                    }
                }
            })
            .await
            .unwrap();
            assert_eq!(result, "verified bytes");
            assert_eq!(
                *attempts.lock().unwrap(),
                vec![Source::Gitee, Source::GitHub]
            );
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn failures_from_both_download_sources_are_reported() {
        let error = try_sources::<(), _, _>(Source::GitHub, |source| async move {
            Err(format!("{} unavailable", source.name()))
        })
        .await
        .unwrap_err();
        assert!(error.contains("GitHub unavailable"));
        assert!(error.contains("Gitee unavailable"));
    }

    #[test]
    fn fallback_rejects_a_different_version_target_or_signature() {
        let expected = UpdateIdentity {
            version: Version::parse("1.3.0").unwrap(),
            target: "darwin".into(),
            signature: "signed-archive".into(),
        };
        for (version, target, signature) in [
            ("1.2.4", "darwin", "signed-archive"),
            ("1.4.0", "darwin", "signed-archive"),
            ("1.3.0", "windows", "signed-archive"),
            ("1.3.0", "darwin", "different-signature"),
        ] {
            let other = UpdateIdentity {
                version: Version::parse(version).unwrap(),
                target: target.into(),
                signature: signature.into(),
            };
            assert!(expected.ensure_matches(&other).is_err());
        }
        assert!(expected.ensure_matches(&expected).is_ok());
    }

    struct Cancelled(Arc<AtomicBool>);
    impl Drop for Cancelled {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn stalled_download_is_cancelled_instead_of_continuing_in_the_background() {
        let (_heartbeat, progress) = watch::channel(());
        let cancelled = Arc::new(AtomicBool::new(false));
        let guard = Cancelled(cancelled.clone());
        let download = async move {
            let _guard = guard;
            std::future::pending::<Result<(), String>>().await
        };
        let started = time::Instant::now();
        let error = with_download_deadlines(
            download,
            progress,
            Duration::from_secs(20),
            Duration::from_secs(60),
        )
        .await
        .unwrap_err();
        assert!(error.contains("无进展"));
        assert_eq!(started.elapsed(), Duration::from_secs(20));
        assert!(cancelled.load(Ordering::SeqCst));
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn stalled_primary_is_cancelled_before_the_mirror_starts() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let attempts = Mutex::new(Vec::new());
        let result = try_sources(Source::Gitee, |source| {
            attempts.lock().unwrap().push(source);
            let cancelled = cancelled.clone();
            async move {
                if source == Source::GitHub {
                    assert!(cancelled.load(Ordering::SeqCst));
                    return Ok("verified mirror bytes");
                }
                let (_heartbeat, progress) = watch::channel(());
                let guard = Cancelled(cancelled);
                with_download_deadlines(
                    async move {
                        let _guard = guard;
                        std::future::pending::<Result<&str, String>>().await
                    },
                    progress,
                    Duration::from_secs(20),
                    Duration::from_secs(60),
                )
                .await
            }
        })
        .await
        .unwrap();
        assert_eq!(result, "verified mirror bytes");
        assert_eq!(
            *attempts.lock().unwrap(),
            vec![Source::Gitee, Source::GitHub]
        );
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn a_slow_but_progressing_download_is_not_treated_as_stalled() {
        let (heartbeat, progress) = watch::channel(());
        let download = async move {
            for _ in 0..4 {
                time::sleep(Duration::from_secs(10)).await;
                heartbeat.send_replace(());
            }
            Ok(42)
        };
        assert_eq!(
            with_download_deadlines(
                download,
                progress,
                Duration::from_secs(20),
                Duration::from_secs(60)
            )
            .await
            .unwrap(),
            42
        );
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn the_total_deadline_also_bounds_continuously_progressing_downloads() {
        let (heartbeat, progress) = watch::channel(());
        let download = async move {
            loop {
                time::sleep(Duration::from_secs(1)).await;
                heartbeat.send_replace(());
            }
            #[allow(unreachable_code)]
            Ok::<(), String>(())
        };
        let started = time::Instant::now();
        let error = with_download_deadlines(
            download,
            progress,
            Duration::from_secs(3),
            Duration::from_secs(5),
        )
        .await
        .unwrap_err();
        assert!(error.contains("最长等待"));
        assert_eq!(started.elapsed(), Duration::from_secs(5));
    }
}
