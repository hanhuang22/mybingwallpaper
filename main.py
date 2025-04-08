# coding:utf-8
import requests
import json
import time
import os

# work_list = [
#     "de-DE", "en-CA", "en-GB", "en-IN", "en-US", "fr-FR", "it-IT", "ja-JP", "zh-CN"
# ]

def get_now_time():
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())


def main(run_type):
    data = requests.get(f"https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt={run_type}").json()
    print(f"[{get_now_time()}] 开始读取 API")
    data_list = data["images"]
    print(f"[{get_now_time()}] 获取到 {len(data_list)} 条数据")
    
    # Process each image in the data list
    for image in data_list:
        # Extract required values
        enddate = image.get('enddate', '')
        date = enddate[:4] + '-' + enddate[4:6] + '-' + enddate[6:8]
        title = image.get('title', '')
        copyright_text = image.get('copyright', '')
        imgtitle = f"{title}  |  {copyright_text}  -  {enddate[:4] + '/' + enddate[4:6] + '/' + enddate[6:8]}"
        
        # Format the image URL to UHD.jpg
        urlbase = image.get('urlbase', '')
        imgurl = f"https://cn.bing.com{urlbase}_UHD.jpg"
        
        # Create a default description based on the image title
        # This can be updated later with more detailed information
        imgdesc = f"这是一张{title}的美丽图片，展示了{copyright_text}。这些图片由微软必应每日更新，为用户提供高质量的壁纸。"
        
        # Create the output directory if it doesn't exist
        os.makedirs('date', exist_ok=True)
        
        # Create the output file path
        file_path = os.path.join('date', f"{enddate}.json")
        
        # Check if the file already exists
        if os.path.exists(file_path):
            print(f"[{get_now_time()}] 文件 {file_path} 已存在，跳过")
            continue
        
        # Prepare the data in the required format
        output_data = [
            {
                "date": date,
                "imgtitle": imgtitle,
                "imgdesc": imgdesc,
                "imgurl": imgurl
            }
        ]
        
        # Write the data to the file
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        
        print(f"[{get_now_time()}] 保存文件 {file_path} 成功")


if __name__ == "__main__":
    main("zh-CN")

