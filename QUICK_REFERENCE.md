# ⚡ QUICK REFERENCE - Brief Studio Refactoring

## 🎯 PRIORIZAÇÃO (do mais urgente para o menos)

| # | Feature | Tempo | Impacto | Status | Start |
|---|---------|-------|--------|--------|-------|
| **1** | 🐛 BUG #4: RESIZE FIX | 1h | ⭐⭐⭐ | 📋 Ready | Semana 1, Dia 1 |
| **2** | 🔍 ZOOM IN/OUT | 3h | ⭐⭐⭐ | 📋 Ready | Semana 1, Dia 2 |
| **3** | 🎯 DRAG & DROP | 4h | ⭐⭐⭐ | 📋 Ready | Semana 1, Dia 4 |
| **4** | 📝 REPLACE + REFLOW | 3h | ⭐⭐⭐ | 📋 Ready | Semana 2, Dia 1 |
| **5** | 🎨 MULTI-SELECT | 5h | ⭐⭐ | 🟡 Depends #3 | Semana 2, Dia 3 |
| **6** | 🔤 BOLD TEXT | 2h | ⭐ | 📋 Ready | Semana 3, Dia 3 |
| **7** | 🔄 CANVAS ROTATION | 2h | ⭐⭐ | 📋 Ready | Semana 3, Dia 1 |

---

## 🔧 ARQUIVOS A MODIFICAR

### BUG #4 - RESIZE FIX (1h)
```
✏️ backend/engines/draft_engine.py
   └─ Linhas 76-84: Mudar divisão por 1.3 para multiplicação
   └─ Adicionar: Validação de direção (aumento vs diminuição)

✏️ frontend/src/components/toolbar/ActionPanel.tsx
   └─ Linhas 48-60: Melhorar input range de font size
   └─ Adicionar: Feedback visual (↑ AUMENTANDO vs ↓ DIMINUINDO)
```

### FEATURE #1 - ZOOM (3h)
```
✏️ frontend/src/store/index.ts
   └─ Adicionar: zoomLevel: number (0.25 a 4.0)
   └─ Adicionar: setZoomLevel(level: number)

✏️ frontend/src/components/canvas/StudioCanvas.tsx
   └─ Adicionar: transform: scale(zoomLevel) no wrapper
   └─ Adicionar: Conversão de coordenadas de mouse / zoomLevel

📝 frontend/src/components/ZoomControl.tsx (novo)
   └─ Botões: Zoom In (+), Zoom Out (-), Reset (100%)
   └─ Display: Label com nível atual (50%, 100%, 200%, etc)
```

### FEATURE #3 - DRAG & DROP (4h)
```
✏️ frontend/src/components/canvas/StudioCanvas.tsx
   └─ Adicionar: isDragging state
   └─ Adicionar: dragStart point tracking
   └─ Adicionar: mousemove listener com cálculo dx/dy
   └─ Adicionar: Preview de nova posição durante drag

✏️ backend/engines/draft_engine.py
   └─ Adicionar: detect_collision() function
   └─ Adicionar: rects_overlap() helper
   └─ Adicionar: Validação de bounds (não sair da página)
```

### FEATURE #5 - REPLACE + REFLOW (3h)
```
✏️ backend/engines/draft_engine.py
   └─ Adicionar: _text_reflow() function
   └─ Modificar: Lógica de REPLACE action (linhas ~76-84)
   └─ Adicionar: Cálculo de altura dinâmica baseado em linhas
```

### FEATURE #2 - MULTI-SELECT (5h)
```
✏️ frontend/src/store/index.ts
   └─ Adicionar: selectedElements: ArtElement[]
   └─ Adicionar: addToSelection, removeFromSelection, clearSelection

✏️ frontend/src/components/canvas/StudioCanvas.tsx
   └─ Modificar: Logic para Shift+Click
   └─ Adicionar: Drag-to-select box
   └─ Adicionar: Highlight múltiplos elementos

✏️ frontend/src/components/toolbar/ActionPanel.tsx
   └─ Adicionar: BatchActionPanel (quando N > 1 elemento selecionado)
```

### FEATURE #6 - BOLD (2h)
```
✏️ frontend/src/components/toolbar/ActionPanel.tsx
   └─ Adicionar: Botão BOLD toggle (⇒ setIsBold state)
   └─ Modificar: handleSave para enviar is_bold no payload

✏️ backend/engines/draft_engine.py
   └─ Adicionar: _font_bold() function
   └─ Modificar: Lógica de REPLACE para usar _font_bold se is_bold=True

✏️ backend/domain/models.py
   └─ Adicionar: is_bold: bool = False ao BriefingAction
```

### FEATURE #7 - ROTATION (2h)
```
✏️ frontend/src/store/index.ts
   └─ Adicionar: canvasRotation: number (0, 90, 180, 270)
   └─ Adicionar: rotateCanvas(clockwise: boolean)

✏️ frontend/src/components/canvas/StudioCanvas.tsx
   └─ Adicionar: transform: rotate(Ndeg) ao canvas wrapper
   └─ Adicionar: rotateCoordinates() function para mouse detection
   └─ Modificar: Todos os mousedown handlers com rotação de coordenadas

📝 frontend/src/components/RotationControl.tsx (novo)
   └─ 4 botões: 0°, 90°, 180°, 270°
```

---

## 📊 DEPENDÊNCIAS ENTRE FEATURES

```
BUG #4 ────────────────────────── (nenhuma)
FEATURE #1 ────────────────────── (nenhuma)
FEATURE #3 ───→ (recomendado ter #1 antes)
FEATURE #5 ────────────────────── (nenhuma)
FEATURE #2 ───→ (requer #3 implementado)
FEATURE #6 ────────────────────── (nenhuma)
FEATURE #7 ────────────────────── (nenhuma)
```

---

## ⏱️ TIMELINE

```
Semana 1 (15 horas):
├─ Seg: BUG #4 (1h) + FEATURE #1 início (3h)
├─ Ter: FEATURE #1 fim (2h) + testes (1h)
├─ Qua: FEATURE #3 (4h)
├─ Qui: FEATURE #3 fim (2h) + testes (1h)
└─ Sex: Buffer + Code Review (1h)

Semana 2 (10 horas):
├─ Seg: FEATURE #5 (3h) + testes (1h)
├─ Ter: FEATURE #2 início (4h)
├─ Qua: FEATURE #2 fim (2h)
└─ Qui-Sex: Buffer + Integration testing

Semana 3 (6 horas):
├─ Seg: FEATURE #7 (2h)
├─ Ter: FEATURE #6 (2h)
├─ Qua: Final integration (2h)
└─ Qui-Sex: QA + Deploy
```

---

## 🧪 TESTES ESSENCIAIS

```
TODOS os features:
✓ Unit tests (pytest backend, jest frontend)
✓ Integration tests (API calls)
✓ Smoke tests (arquivo PDF de referência)
✓ Manual QA (checklist visual)

Cada feature tem seu próprio teste:
BUG #4:  test_resize_increases(), test_resize_decreases()
FEATURE #1: test_zoom_level_calculation(), test_coordinate_scaling()
FEATURE #3: test_drag_calculates_delta(), test_collision_detection()
FEATURE #5: test_text_reflow_wraps_correctly()
FEATURE #2: test_multiple_selection_state()
FEATURE #6: test_bold_font_applied()
FEATURE #7: test_coordinate_rotation()
```

---

## 💾 DEPLOYMENT

```
1. git checkout -b features/7-improvements
2. git add REFACTORING_STRATEGY.md IMPLEMENTATION_BUG4_RESIZE.md RESUMO_EXECUTIVO.md
3. Implementar cada feature em PR separada
4. Tests pass + Code review pass = merge
5. docker-compose down && docker-compose up --build
6. Smoke tests em produção
7. Tag release: v2.1.0
```

---

## 📌 CHECKPOINTS

**Final de Semana 1**: BUG #4 + FEATURES #1, #3 prontos
- [ ] Todos testes passando
- [ ] Zoom funciona 0.25x a 4.0x
- [ ] Drag & Drop intuitivo
- [ ] Resize corrigido
- [ ] Sem regressions

**Final de Semana 2**: FEATURES #5, #2 prontos  
- [ ] Reflow funciona com textos longos
- [ ] Multi-select com Shift+Click
- [ ] Batch operations
- [ ] Sem regressions

**Final de Semana 3**: FEATURES #7, #6 + Deploy
- [ ] Canvas rotaciona 90°
- [ ] Bold text aplicável
- [ ] QA manual 100%
- [ ] Deploy para produção
- [ ] Versão 2.1.0 live

---

## 🆘 TROUBLESHOOTING

| Problema | Solução |
|----------|---------|
| Zoom deixa mouse desalinhado | Verificar cálculo de `clickX / zoomLevel` |
| Drag & Drop sai da página | Implementar bounds validation |
| Texto reflow não quebra | Verificar width do elemento em pixels |
| Multi-select não detecta box | Confirmar isDrawing state reset no mouseup |
| Rotation gira errado | Verificar matemática de rotação em radianos |
| Bold não aparece no PDF | Confirmar caminho da fonte DejaVuSans-Bold.ttf |

---

## 📚 REFERÊNCIAS

```
Frontend:
- Fabric.js docs: http://fabricjs.com/
- CSS transforms: https://developer.mozilla.org/en-US/docs/Web/CSS/transform
- Zustand: https://github.com/pmndrs/zustand

Backend:
- PyMuPDF docs: https://pymupdf.readthedocs.io/
- Pillow ImageDraw: https://pillow.readthedocs.io/en/stable/reference/ImageDraw.html
- SQLAlchemy async: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
```

---

## ✨ DICAS DE DESENVOLVIMENTO

1. **Sempre testar com zoom**: Mudanças de coordenadas afetam zoom
2. **Log todas conversões de unidades**: PDF points ≠ pixels ≠ normalized coords
3. **Use transformações CSS**: Mais performático que redraw de canvas
4. **Teste com PDFs reais**: image_338a1d.jpg + prova_1.pdf
5. **Performance**: requestAnimationFrame para drag/zoom
6. **Documentação**: Adicionar comments em toda conversão de coordenadas

---

**Última atualização**: 04/06/2026  
**Status**: Pronto para começar 🚀
