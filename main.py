# coding:utf-8
import requests
import json
import time
import os
from ali_oss import bucket

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
    
    # Dictionary to store monthly data
    monthly_data = {}
    
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
        
        # Get month key (YYYYMM)
        month_key = enddate[:6]
        
        # Get day key (YYYYMMDD - full date)
        day_key = enddate
        
        # Create or update the monthly data
        if month_key not in monthly_data:
            monthly_data[month_key] = {}
        
        # Add this day's data to the monthly data
        monthly_data[month_key][day_key] = {
            "date": date,
            "imgtitle": imgtitle,
            "imgdesc": imgdesc,
            "imgurl": imgurl
        }
    
    # Create the output directory if it doesn't exist
    os.makedirs('month', exist_ok=True)
    
    # Save each month's data to a separate file
    for month_key, month_data in monthly_data.items():
        file_path = os.path.join('month', f"{month_key}.json")
        
        # Check if the file already exists and merge with existing data
        if os.path.exists(file_path):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    existing_data = json.load(f)
                # Merge existing data with new data
                existing_data.update(month_data)
                month_data = existing_data
                print(f"[{get_now_time()}] 合并文件 {file_path} 数据")
            except Exception as e:
                print(f"[{get_now_time()}] 读取文件 {file_path} 失败: {e}")
        
        # Write the data to the file
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(month_data, f, ensure_ascii=False, indent=2)
        
        # 上传文件到阿里云OSS
        try:
            linux_file_path = file_path.replace('\\', '/')
            bucket.put_object_from_file(linux_file_path, linux_file_path)
            print(f"[{get_now_time()}] 上传文件 {linux_file_path} 成功")
        except Exception as e:
            print(f"[{get_now_time()}] 上传文件 {file_path} 失败: {e}")
        
        print(f"[{get_now_time()}] 保存文件 {file_path} 成功")


if __name__ == "__main__":
    main("zh-CN")

