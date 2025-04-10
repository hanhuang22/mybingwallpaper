# coding:utf-8
import json
import os
import time
from collections import defaultdict

def get_now_time():
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())

def migrate_daily_to_monthly():
    print(f"[{get_now_time()}] 开始整理日期文件到月度文件")
    
    # Check if date directory exists
    if not os.path.exists('date'):
        print(f"[{get_now_time()}] 'date' 目录不存在")
        return
    
    # Create month directory if it doesn't exist
    os.makedirs('month', exist_ok=True)
    
    # Dictionary to store data by month
    monthly_data = defaultdict(dict)
    
    # Get all JSON files in the date directory
    daily_files = [f for f in os.listdir('date') if f.endswith('.json')]
    print(f"[{get_now_time()}] 找到 {len(daily_files)} 个日期文件")
    
    # Process each daily file
    for daily_file in daily_files:
        try:
            # Extract date from filename (format: YYYYMMDD.json)
            date_str = daily_file.split('.')[0]
            
            # Skip files with invalid format
            if not (date_str.isdigit() and len(date_str) == 8):
                print(f"[{get_now_time()}] 跳过无效文件名: {daily_file}")
                continue
            
            # Get month key (YYYYMM)
            month_key = date_str[:6]
            
            # Get day key (YYYYMMDD - full date)
            day_key = date_str
            
            # Read the daily file
            with open(os.path.join('date', daily_file), 'r', encoding='utf-8') as f:
                daily_data = json.load(f)
            
            # Add to monthly data if it's a valid list with at least one item
            if isinstance(daily_data, list) and len(daily_data) > 0:
                # The first item in the list contains the data we want
                monthly_data[month_key][day_key] = daily_data[0]
                print(f"[{get_now_time()}] 处理文件 {daily_file} 成功")
            else:
                print(f"[{get_now_time()}] 文件格式不正确: {daily_file}")
                
        except Exception as e:
            print(f"[{get_now_time()}] 处理文件 {daily_file} 时出错: {e}")
    
    # Save monthly data to files
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
        
        print(f"[{get_now_time()}] 保存文件 {file_path} 成功")
    
    print(f"[{get_now_time()}] 整理完成，共生成 {len(monthly_data)} 个月度文件")

if __name__ == "__main__":
    migrate_daily_to_monthly() 