import pandas as pd

df = pd.read_excel(r'C:\Users\motaz\OneDrive\Desktop\MyRX\tmp\movements_rename.xlsx')
has = df[df['Update'].notna() & (df['Update'].astype(str).str.strip() != '')]
print(f'Total rows: {len(df)} | rows with comments: {len(has)}')
print()
for _, r in has.iterrows():
    cat = str(r['Category'])
    name = str(r['Current Name'])
    upd = str(r['Update']).strip()
    print(f'[{cat:<8}] {name:<45} -> {upd}')
