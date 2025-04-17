import os
import json
import calendar
from datetime import datetime
import re

def get_month_name(month_key):
    """Get month name from month key (YYYYMM)"""
    year = month_key[:4]
    month = month_key[4:6]
    month_name = calendar.month_name[int(month)]
    return f"{month_name} {year}"

def generate_monthly_markdown():
    """Generate markdown files for all months"""
    # Create markdown directory if it doesn't exist
    os.makedirs('markdown', exist_ok=True)
    
    # List all month files
    months = []
    for filename in os.listdir('month'):
        if filename.endswith('.json'):
            month_key = filename[:-5]  # Remove .json extension
            months.append(month_key)
    
    # Sort months in descending order (newest first)
    months.sort(reverse=True)
    
    # Generate markdown for each month
    for month_key in months:
        generate_markdown_for_month(month_key)
    
    return months

def update_selected_months(month_keys):
    """Generate markdown files only for the specified months"""
    # Create markdown directory if it doesn't exist
    os.makedirs('markdown', exist_ok=True)
    
    # Sort months in descending order (newest first)
    month_keys.sort(reverse=True)
    
    # Generate markdown for each specified month
    for month_key in month_keys:
        generate_markdown_for_month(month_key)
    
    # Get all available months for the README
    all_months = []
    for filename in os.listdir('month'):
        if filename.endswith('.json'):
            month_key = filename[:-5]  # Remove .json extension
            all_months.append(month_key)
    
    all_months.sort(reverse=True)
    return all_months

def generate_markdown_for_month(month_key):
    """Generate markdown file for a specific month"""
    month_file = os.path.join('month', f"{month_key}.json")
    
    # Load month data
    try:
        with open(month_file, 'r', encoding='utf-8') as f:
            month_data = json.load(f)
    except Exception as e:
        print(f"Error reading {month_file}: {e}")
        return
    
    # Sort dates in ascending order
    dates = sorted(month_data.keys())
    
    # Create markdown content
    month_name = get_month_name(month_key)
    markdown_content = f"# Bing Wallpapers - {month_name}\n\n"
    
    # Create table header
    markdown_content += "| | | | |\n"
    markdown_content += "|:-------------------------:|:-------------------------:|:-------------------------:|:-------------------------:|\n"
    
    # Create table rows with 4 images per row
    row_images = []
    for date_key in dates:
        image_data = month_data[date_key]
        date = image_data['date']
        title = image_data['imgtitle']
        
        # Extract the main title part
        if "|" in title:
            title = title.split("|")[1].strip()
        elif "  |  " in title:
            title = title.split("  |  ")[1].strip()
        
        url = image_data['imgurl']
        preview_url = url
        if "bing.com" in url:
            preview_url = url+"&w=480"

        # Create markdown for image with fixed size
        image_markdown = f"<a href=\"{url}\" target=\"_blank\"><img src=\"{preview_url}\" width=\"240\" height=\"135\" alt=\"{title}\" title=\"{title}\"></a><br>{date}<br>"
        row_images.append(image_markdown)
        
        # Add row if we have 4 images
        if len(row_images) == 4:
            markdown_content += f"| {row_images[0]} | {row_images[1]} | {row_images[2]} | {row_images[3]} |\n"
            row_images = []
    
    # Add remaining images if any
    if row_images:
        # Fill empty cells with empty strings
        while len(row_images) < 4:
            row_images.append("")
        markdown_content += f"| {row_images[0]} | {row_images[1]} | {row_images[2]} | {row_images[3]} |\n"
    
    # Write markdown file
    markdown_file = os.path.join('markdown', f"{month_key}.md")
    with open(markdown_file, 'w', encoding='utf-8') as f:
        f.write(markdown_content)
    
    print(f"Generated {markdown_file}")

def update_readme(months):
    """Update README.md with current month's images and links to archive"""
    if not months:
        return
    
    current_month = months[0]  # Most recent month
    month_file = os.path.join('month', f"{current_month}.json")
    
    # Load current month data
    try:
        with open(month_file, 'r', encoding='utf-8') as f:
            month_data = json.load(f)
    except Exception as e:
        print(f"Error reading {month_file}: {e}")
        return
    
    # Sort dates in descending order (newest first)
    dates = sorted(month_data.keys(), reverse=True)
    
    # Create README content
    readme_content = "# My Bing Wallpaper\n\n"
    readme_content += "Daily Bing wallpapers collection\n\n"
    
    # Current month section
    month_name = get_month_name(current_month)
    readme_content += f"## Current Month: {month_name}\n\n"
    
    # Create table header
    readme_content += "| | | | |\n"
    readme_content += "|:-------------------------:|:-------------------------:|:-------------------------:|:-------------------------:|\n"
    
    # Create table rows with 4 images per row
    row_images = []
    for date_key in dates:
        image_data = month_data[date_key]
        date = image_data['date']
        title = image_data['imgtitle']
        
        # Extract the main title part
        if "|" in title:
            title = title.split("|")[1].strip()
        elif "  |  " in title:
            title = title.split("  |  ")[1].strip()
        
        url = image_data['imgurl']
        preview_url = url
        if "bing.com" in url:
            preview_url = url+"&w=480"
        
        # Create markdown for image with fixed size
        image_markdown = f"<a href=\"{url}\" target=\"_blank\"><img src=\"{preview_url}\" width=\"240\" height=\"135\" alt=\"{title}\" title=\"{title}\"></a><br>{date}<br>"
        row_images.append(image_markdown)
        
        # Add row if we have 4 images
        if len(row_images) == 4:
            readme_content += f"| {row_images[0]} | {row_images[1]} | {row_images[2]} | {row_images[3]} |\n"
            row_images = []
    
    # Add remaining images if any
    if row_images:
        # Fill empty cells with empty strings
        while len(row_images) < 4:
            row_images.append("")
        readme_content += f"| {row_images[0]} | {row_images[1]} | {row_images[2]} | {row_images[3]} |\n"
    
    # Archive section
    readme_content += "\n## Archive\n\n"
    
    # Group months by year
    years = {}
    for month_key in months:
        year = month_key[:4]
        month = month_key[4:6]
        
        if year not in years:
            years[year] = []
        
        years[year].append(month)
    
    # Sort years in descending order
    for year in sorted(years.keys(), reverse=True):
        # Sort months in ascending order for each year
        sorted_months = sorted(years[year])
        
        # Create a row with months for this year
        readme_content += f"**{year}**: | "
        month_links = []
        
        for month in sorted_months:
            month_key = f"{year}{month}"
            month_num = int(month)  # Convert to integer to remove leading zero if present
            month_links.append(f"[{month_num}](markdown/{month_key}.md)")
        
        readme_content += " | ".join(month_links) + "\n\n"
    
    # Write README file
    with open('README.md', 'w', encoding='utf-8') as f:
        f.write(readme_content)
    
    print("Updated README.md")

if __name__ == "__main__":
    months = generate_monthly_markdown()
    update_readme(months) 