import sys, os
sys.path.insert(0, '/app')
os.environ['DATABASE_URL'] = 'postgresql://briefing:briefing123@db/briefing_db'
import fitz
from pathlib import Path
from engines.pdf_draft_engine import generate_pdf_draft, _get_page_spans

pdf = '/app/uploads/3e1f89674b4045638f15b987275e5995_SKU_CODE_CLIENT_PRODUCT_DURA_4 pc_Carton.pdf'
doc = fitz.open(pdf)
page = doc[0]
pw, ph = page.rect.width, page.rect.height
spans = _get_page_spans(page)
doc.close()

target = next((s for s in spans if 'Tabletas' in s['text']), None)
bx0,by0,bx1,by1 = target['bbox']

# T16: long replace
long_text = ('Paracetamol de liberacion prolongada 325 mg ' * 12).strip()
a1 = {'action_type':'replace','page':0,'sel_x':bx0/pw,'sel_y':by0/ph,'sel_w':(bx1-bx0)/pw,'sel_h':(by1-by0)/ph,'element_id':'t','new_text':long_text}
r1 = generate_pdf_draft(pdf, [a1], page_number=0, output_dir='/tmp')
Path(r1['draft_path']).unlink(missing_ok=True)
tgt_in = [c for c in r1['collisions'] if c['span_text']=='Tabletas']
print('T16: collisions=%d, target_in_list=%s' % (len(r1['collisions']), bool(tgt_in)))
print('     spans:', [c['span_text'] for c in r1['collisions'][:4]])

# T17: resize 72pt
a2 = {'action_type':'resize','page':0,'sel_x':bx0/pw,'sel_y':by0/ph,'sel_w':(bx1-bx0)/pw,'sel_h':(by1-by0)/ph,'element_id':'t','original_text':'Tabletas','new_font_size':72.0,'new_text':''}
r2 = generate_pdf_draft(pdf, [a2], page_number=0, output_dir='/tmp')
Path(r2['draft_path']).unlink(missing_ok=True)
tgt_in2 = [c for c in r2['collisions'] if c['span_text']=='Tabletas']
print('T17: collisions=%d, skipped=%d, target_in_list=%s' % (len(r2['collisions']), r2['actions_skipped'], bool(tgt_in2)))
print('     spans:', [c['span_text'] for c in r2['collisions'][:4]])

# T13: short replace (no collision expected)
a3 = {'action_type':'replace','page':0,'sel_x':bx0/pw,'sel_y':by0/ph,'sel_w':(bx1-bx0)/pw,'sel_h':(by1-by0)/ph,'element_id':'t','new_text':'T'}
r3 = generate_pdf_draft(pdf, [a3], page_number=0, output_dir='/tmp')
Path(r3['draft_path']).unlink(missing_ok=True)
print('T13 no-coll: collisions=%s' % r3['collisions'])
