#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont
import sys
import os

def get_font(size):
    font_paths = [
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/SFNSDisplay.ttf',
        '/Library/Fonts/Arial Bold.ttf',
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    ]
    for path in font_paths:
        try:
            return ImageFont.truetype(path, size)
        except (IOError, OSError):
            continue
    return ImageFont.load_default()

def generate_icon(size, filename):
    img = Image.new('RGB', (size, size), color='#0D1B2A')
    draw = ImageDraw.Draw(img)

    # Blue circle accent (top-right)
    r = size // 8
    cx = size - r - size // 12
    cy = r + size // 12
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill='#4A9EFF')

    # Small inner highlight on circle
    r2 = r // 2
    draw.ellipse([cx - r2, cy - r2 - r // 4, cx + r2 // 2, cy + r2 // 4], fill='#7FC3FF')

    # "SR" text
    font_size = size // 3
    font = get_font(font_size)

    text = "SR"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1] + size // 20

    # Shadow
    draw.text((x + 2, y + 2), text, fill='#0A1520', font=font)
    draw.text((x, y), text, fill='#FFFFFF', font=font)

    img.save(filename, 'PNG')
    print(f"Generated {filename} ({size}x{size})")

try:
    generate_icon(192, 'icon-192.png')
    generate_icon(512, 'icon-512.png')
    print("Icons generated successfully.")
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
