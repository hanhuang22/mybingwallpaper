import copy
import unittest

from main import build_monthly_data, merge_month_data


class ArchiveDateTests(unittest.TestCase):
    def setUp(self):
        self.model = {
            "MediaContents": [
                {
                    "Ssd": "20260831",
                    "ImageContent": {
                        "Headline": "A headline",
                        "Title": "A coast",
                        "Copyright": "© Photographer",
                        "Description": "A description",
                        "Image": {"Url": "/th?id=OHR.Test_ZH-CN123_1920x1080.jpg"},
                    },
                }
            ]
        }
        self.archive = {
            "images": [
                {
                    "urlbase": "/th?id=OHR.Test_ZH-CN123",
                    "enddate": "20260831",
                    "copyright": "A coast (© Photographer)",
                }
            ]
        }

    def test_uses_zh_cn_archive_date_without_adding_a_day(self):
        result = build_monthly_data(self.model, self.archive)
        self.assertEqual(list(result), ["202608"])
        self.assertEqual(list(result["202608"]), ["20260831"])
        self.assertEqual(result["202608"]["20260831"]["date"], "2026-08-31")

    def test_rejects_wrong_caption_for_image(self):
        model = copy.deepcopy(self.model)
        model["MediaContents"][0]["ImageContent"]["Title"] = "Malta boats"
        with self.assertRaisesRegex(ValueError, "caption disagree"):
            build_monthly_data(model, self.archive)

    def test_rejects_date_disagreement_between_bing_endpoints(self):
        model = copy.deepcopy(self.model)
        model["MediaContents"][0]["Ssd"] = "20260901"
        with self.assertRaisesRegex(ValueError, "date mismatch"):
            build_monthly_data(model, self.archive)

    def test_rejects_missing_archive_image(self):
        archive = {"images": [{**self.archive["images"][0], "urlbase": "/th?id=OHR.Other_ZH-CN456"}]}
        with self.assertRaisesRegex(ValueError, "missing from the zh-CN archive"):
            build_monthly_data(self.model, archive)

    def test_rejects_replacing_an_existing_date_with_another_image(self):
        existing = {"20260831": {"imgurl": "https://cn.bing.com/old.jpg"}}
        incoming = {"20260831": {"imgurl": "https://cn.bing.com/new.jpg"}}
        with self.assertRaisesRegex(ValueError, "Refusing to replace"):
            merge_month_data(existing, incoming)


if __name__ == "__main__":
    unittest.main()
