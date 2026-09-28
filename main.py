# coding:utf-8
import requests
import json
import time
import os
import importlib.util
from datetime import datetime

# work_list = [
#     "de-DE", "en-CA", "en-GB", "en-IN", "en-US", "fr-FR", "it-IT", "ja-JP", "zh-CN"
# ]

def get_now_time():
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())


def build_monthly_data(model_data, archive_data):
    """Use the zh-CN archive date and reject inconsistent Bing metadata."""
    data_list = model_data["MediaContents"]
    archive_images = archive_data["images"]
    if not data_list or not archive_images:
        raise ValueError("Bing returned an empty image list")

    archive_by_urlbase = {image["urlbase"]: image for image in archive_images}
    monthly_data = {}
    for media in data_list:
        image_data = media["ImageContent"]
        image_url = image_data["Image"]["Url"]
        urlbase = "_".join(image_url.split("_")[:2])
        archive_image = archive_by_urlbase.get(urlbase)
        if archive_image is None:
            raise ValueError(f"Image is missing from the zh-CN archive: {urlbase}")

        enddate = archive_image["enddate"]
        datetime.strptime(enddate, "%Y%m%d")
        ssd = str(media["Ssd"])[:8]
        if ssd != enddate:
            raise ValueError(f"Bing date mismatch for {urlbase}: Ssd={ssd}, enddate={enddate}")

        headline = image_data["Headline"].strip()
        title = image_data["Title"].strip()
        copyright_text = image_data["Copyright"].strip()
        description = image_data["Description"].strip()
        archive_credit = archive_image["copyright"]
        if not all((headline, title, copyright_text, description)):
            raise ValueError(f"Incomplete Bing metadata for {urlbase}")
        if title not in archive_credit or copyright_text not in archive_credit:
            raise ValueError(f"Image and caption disagree for {urlbase}")

        date = f"{enddate[:4]}-{enddate[4:6]}-{enddate[6:8]}"
        imgtitle = f"{headline}  |  {title} {copyright_text}  -  {enddate[:4] + '/' + enddate[4:6] + '/' + enddate[6:8]}"
        imgurl = f"https://cn.bing.com{urlbase}_UHD.jpg"

        month_data = monthly_data.setdefault(enddate[:6], {})
        if enddate in month_data and month_data[enddate]["imgurl"] != imgurl:
            raise ValueError(f"Two different images share the same date: {enddate}")
        month_data[enddate] = {
            "date": date,
            "imgtitle": imgtitle,
            "imgdesc": description,
            "imgurl": imgurl
        }
    return monthly_data


def merge_month_data(existing_data, incoming_data):
    for day_key, record in incoming_data.items():
        previous = existing_data.get(day_key)
        if previous and previous.get('imgurl') != record['imgurl']:
            raise ValueError(f"Refusing to replace a different image on {day_key}")
    return {**existing_data, **incoming_data}


def main(run_type):
    model_response = requests.get(
        "https://www.bing.com/hp/api/model", params={"mkt": run_type}, timeout=20
    )
    model_response.raise_for_status()
    archive_response = requests.get(
        "https://www.bing.com/HPImageArchive.aspx",
        params={"format": "js", "idx": 0, "n": 8, "mkt": run_type},
        timeout=20,
    )
    archive_response.raise_for_status()
    monthly_data = build_monthly_data(model_response.json(), archive_response.json())
    print(f"[{get_now_time()}] Verified {sum(map(len, monthly_data.values()))} Bing images")

    os.makedirs('month', exist_ok=True)
    merged_months = {}
    for month_key, month_data in monthly_data.items():
        file_path = os.path.join('month', f"{month_key}.json")
        existing_data = {}
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
        merged = merge_month_data(existing_data, month_data)
        if merged != existing_data:
            merged_months[month_key] = merged

    if not merged_months:
        print(f"[{get_now_time()}] No archive changes")
        return

    from ali_oss import bucket
    affected_months = list(merged_months)
    for month_key, month_data in merged_months.items():
        file_path = os.path.join('month', f"{month_key}.json")
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(month_data, f, ensure_ascii=False, indent=2)
        linux_file_path = file_path.replace('\\', '/')
        upload = bucket.put_object_from_file(linux_file_path, linux_file_path)
        if upload.status != 200:
            raise RuntimeError(f"OSS upload failed for {linux_file_path}: {upload.status}")
        print(f"[{get_now_time()}] Saved and uploaded {linux_file_path}")
    
    # Generate markdown files and update README
    print(f"[{get_now_time()}] 开始生成 Markdown 文件")
    spec = importlib.util.spec_from_file_location("generate_markdown", "generate_markdown.py")
    generate_markdown = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generate_markdown)
    months = generate_markdown.update_selected_months(affected_months)
    generate_markdown.update_readme(months)
    print(f"[{get_now_time()}] Markdown 文件生成完成")


if __name__ == "__main__":
    main("zh-CN")

