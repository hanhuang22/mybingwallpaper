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
    # data = requests.get(f"https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt={run_type}").json()
    data = requests.get(f"https://www.bing.com/hp/api/model?mkt={run_type}").json()
    print(f"[{get_now_time()}] 开始读取 API")
    data_list = data["MediaContents"]
    print(f"[{get_now_time()}] 获取到 {len(data_list)} 条数据")
    
    # Process each image in the data list
    for image_data in data_list:
        # Extract required values
        ssd = image_data.get('Ssd', '')
        enddate = str(int(ssd[:8])+1)
        image_data = image_data.get('ImageContent', '')
        date = enddate[:4] + '-' + enddate[4:6] + '-' + enddate[6:8]
        headline = image_data.get('Headline', '')
        title = image_data.get('Title', '')
        copyright_text = image_data.get('Copyright', '')
        imgtitle = f"{headline}  |  {title} {copyright_text}  -  {enddate[:4] + '/' + enddate[4:6] + '/' + enddate[6:8]}"
        
        # Format the image URL to UHD.jpg
        urlbase = image_data.get('Image', '').get('Url', '').split('_')[:2]
        urlbase = '_'.join(urlbase)
        imgurl = f"https://cn.bing.com{urlbase}_UHD.jpg"
        
        imgdesc = image_data.get('Description', '')
        
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

