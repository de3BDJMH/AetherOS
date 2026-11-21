"""生成用户脚本和版本文件，并检查发布文件是否与源码一致。"""
import argparse
import json
import math
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def escaped(char):
    value=ord(char)
    if value<128:return char
    if value<=0xffff:return f"\\u{value:04x}"
    value-=0x10000
    return f"\\u{0xd800+(value>>10):04x}\\u{0xdc00+(value&1023):04x}"

def artifacts():
    source=(ROOT/'src/aetheros.js').read_text(encoding='utf-8-sig')
    header=re.match(r'// ==UserScript==\n.*?// ==/UserScript==\n',source,re.S)
    if not header:raise ValueError('缺少用户脚本信息头')
    version=re.search(r'^// @version\s+(\d+\.\d+\.\d+)\s*$',header[0],re.M)
    if not version or source.count('__AETHEROS_VERSION__')!=1:raise ValueError('版本声明无效')
    source=source.replace('__AETHEROS_VERSION__',version[1])
    marker='__AETHEROS_SPECTRUM_LEVELS__'
    if source.count(marker)!=1:raise ValueError('光谱等级数据标记无效')
    levels=json.loads((ROOT/'src/spectrum-levels.json').read_text(encoding='utf-8'))
    if not levels or any(not key.startswith('prism_') or not isinstance(row.get('max_level'),int) or not 1<=row['max_level']<=4 or not isinstance(row.get('fields'),list) for key,row in levels.items()):raise ValueError('光谱等级数据无效')
    source=source.replace(marker,json.dumps(levels,ensure_ascii=True,separators=(',',':')))
    quality_marker='__AETHEROS_EQUIPMENT_QUALITY__'
    if source.count(quality_marker)!=1:raise ValueError('装备评分数据标记无效')
    quality=json.loads((ROOT/'src/equipment-quality.json').read_text(encoding='utf-8'))
    if quality.get('version')!=1 or not quality.get('items') or not quality.get('labels'):raise ValueError('装备评分资料无效')
    for key,row in quality['items'].items():
        if not isinstance(key,str) or row.get('slot') not in {'weapon','top','bottom','gloves','shoes','accessory'} or not isinstance(row.get('stats'),list):raise ValueError('装备评分条目无效')
        for field in row['stats']:
            if not isinstance(field,list) or len(field)!=3 or field[0] not in quality['labels'] or any(type(v) not in {int,float} or not math.isfinite(v) for v in field[1:]) or field[2]<=field[1]:raise ValueError('装备评分范围无效')
    source=source.replace(quality_marker,json.dumps(quality,ensure_ascii=True,separators=(',',':')))
    # 保留信息头和中文注释，运行文案转义，避免安装工具误判中文编码。
    script=''.join(line if line.lstrip().startswith('//') else ''.join(map(escaped,line)) for line in source.splitlines(keepends=True))
    return {'AetherOS.user.js':script.encode('utf-8-sig'),'AetherOS.meta.js':header[0].encode('utf-8-sig')}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='仅检查生成文件，不写入')
    args=parser.parse_args()
    for name,content in artifacts().items():
        target=ROOT/name
        if args.check:
            if not target.exists() or target.read_bytes()!=content:raise SystemExit(f'{name} 未生成或已过期，请运行 tools/release.py')
        else:target.write_bytes(content)
    print('发布文件与源码一致' if args.check else '已生成 AetherOS.user.js 和 AetherOS.meta.js')

if __name__=='__main__':main()
