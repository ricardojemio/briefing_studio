# 📋 ESTRATÉGIA DE REFATORAÇÃO - Brief Studio PDF Editor

## 🎯 PRIORIZAÇÃO RECOMENDADA

### FASE 1: QUICK WINS (Impacto Alto + Complexidade Baixa)
1. **[BUG #4] INVERSÃO DE RESIZE** ⭐⭐⭐ (COMECE AQUI)
2. **[FEATURE #1] ZOOM IN/OUT** ⭐⭐⭐
3. **[FEATURE #3] DRAG & DROP** ⭐⭐⭐

### FASE 2: CORE IMPROVEMENTS (Impacto Alto + Complexidade Média)
4. **[FEATURE #5] REPLACE COM REFLOW** ⭐⭐⭐
5. **[FEATURE #2] SELEÇÃO MÚLTIPLA** ⭐⭐

### FASE 3: POLISH (Nice-to-Have)
6. **[FEATURE #7] ROTAÇÃO DO CANVAS** ⭐⭐
7. **[FEATURE #6] BOLD TEXT** ⭐

---

## 📍 DIAGNÓSTICO DETALHADO

### BUG #4: INVERSÃO DE RESIZE ⚠️ CRÍTICO - COMECE AQUI

**Localização do Bug:**
- **Frontend**: `src/components/toolbar/ActionPanel.tsx` (linha ~48)
- **Backend**: `backend/engines/draft_engine.py` (linha ~76)

**Problema Raiz:**
```javascript
// ActionPanel.tsx - Estado do newFs vai correto
const [newFs, setNewFs] = useState(element?.font_size || 12)
// Mas ao enviar... vai com sinal invertido?

// draft_engine.py - Aqui está o problema:
nfpx=int(nfs*scale/1.3)  // INVERSÃO: deveria estar verificando se aumenta ou diminui
```

**Por que ocorre:**
- O cálculo de `fpx` em `draft_engine.py` não está validando se o novo tamanho é maior ou menor
- A escala de multiplicação `scale/1.3` pode estar invertida dependendo do DPI

**Solução Técnica:**
1. Adicionar validação no backend: `if new_font_size > original_font_size: AUMENTAR else: DIMINUIR`
2. Reverter o multiplicador de escala para `scale * 1.3` (ao invés de divisão)
3. Adicionar testes unitários: `test_resize_increases()` e `test_resize_decreases()`

**Esforço Estimado**: 30 minutos  
**Arquivos a Alterar**: 2 (ActionPanel.tsx, draft_engine.py)

---

### FEATURE #1: ZOOM IN/OUT 🔍

**Localização:**
- **Frontend**: `src/components/canvas/StudioCanvas.tsx` (linhas 30-70)
- **Frontend**: `src/store/index.ts` (estado global)

**Problema Atual:**
- Canvas está em escala fixa (100%)
- Impossível selecionar textos < 8pt
- Sem feedback visual de zoom level

**Solução Técnica:**

```typescript
// Adicionar ao store (Zustand):
interface StudioStore {
  zoomLevel: number  // 0.5 = 50%, 1.0 = 100%, 2.0 = 200%
  setZoomLevel: (level: number) => void
  canvasWidth: number
  canvasHeight: number
}

// No StudioCanvas.tsx:
// 1. Aplicar transform: scale() no canvas wrapper
// 2. Recalcular coordenadas de mouse: 
//    clickX_real = clickX_screen / zoomLevel
//    clickY_real = clickY_screen / zoomLevel

// 3. Componente de controle de zoom:
<ZoomControl 
  level={zoomLevel} 
  onZoom={(delta) => setZoomLevel(prev => prev + delta)}
  min={0.25} 
  max={4.0}
/>
```

**Matemática de Coordenadas:**
```
MouseClick (screen space) → Divide by zoomLevel → Element coordinates (canvas space)
Element bounds (canvas) → Multiply by zoomLevel → Screen position (render)
```

**Esforço Estimado**: 2-3 horas  
**Arquivos a Alterar**: 3 (StudioCanvas.tsx, store/index.ts, novo: ZoomControl.tsx)

---

### FEATURE #3: DRAG & DROP DIRETO 🎯

**Localização:**
- **Frontend**: `src/components/canvas/StudioCanvas.tsx`
- **Backend**: `backend/engines/draft_engine.py` (lógica de detecção de colisão)

**Problema Atual:**
- ActionPanel força digitação de Delta X e Y em mm
- Sem feedback visual durante drag
- Sem detecção de colisão com elementos vizinhos

**Solução Técnica:**

```typescript
// Em StudioCanvas.tsx - adicionar drag state:
const [isDragging, setIsDragging] = useState(false)
const [dragStart, setDragStart] = useState<{x: number, y: number} | null>(null)
const [dragOffset, setDragOffset] = useState({dx: 0, dy: 0})

// Mouse listeners:
rect.on('mousedown', (e) => {
  if (e.button === 0) {  // Left click
    setIsDragging(true)
    setDragStart({x: e.pageX, y: e.pageY})
  }
})

document.on('mousemove', (e) => {
  if (!isDragging || !dragStart) return
  
  const dx_px = e.pageX - dragStart.x
  const dy_px = e.pageY - dragStart.y
  
  // Converter para mm (72 DPI = 25.4 mm)
  const dx_mm = (dx_px / scale) * 25.4 / 72
  const dy_mm = (dy_px / scale) * 25.4 / 72
  
  setDragOffset({dx: dx_mm, dy: dy_mm})
  
  // Mostrar preview de nova posição
  updatePreviewPosition(elem, dx_mm, dy_mm)
})

document.on('mouseup', () => {
  if (isDragging && dragOffset) {
    saveAction({
      type: 'move',
      dx_mm: dragOffset.dx,
      dy_mm: dragOffset.dy
    })
  }
  setIsDragging(false)
})
```

**No Backend (colisão básica):**
```python
# draft_engine.py - nova função:
def detect_collision(elem_new_bounds, all_elements):
    """Retorna lista de elementos que colidem com a nova posição"""
    collisions = []
    for other in all_elements:
        if other['id'] == elem_new_bounds['id']: continue
        if rects_overlap(elem_new_bounds, other):
            collisions.append(other)
    return collisions

def rects_overlap(rect1, rect2):
    return (rect1['x'] < rect2['x'] + rect2['w'] and
            rect1['x'] + rect1['w'] > rect2['x'] and
            rect1['y'] < rect2['y'] + rect2['h'] and
            rect1['y'] + rect1['h'] > rect2['y'])
```

**Esforço Estimado**: 3-4 horas  
**Arquivos a Alterar**: 2 (StudioCanvas.tsx, draft_engine.py)

---

### FEATURE #5: REPLACE COM REFLOW 📝

**Localização:**
- **Backend**: `backend/engines/draft_engine.py` (linhas 76-84)
- **Backend**: `backend/api/routes.py` (validação)

**Problema Atual:**
```python
# Código atual - CORTA texto longo:
if "replace" in at:
    nt=action.get("new_text")
    draw.rectangle([x0-2,y0-2, x1+max(len(nt)*fpx//2,w)+4, y1+4], fill=bg)
    draw.text((x0,y0), nt, fill=oc, font=fnt)
    # ↑ Sem quebra de linha, sem cálculo de altura
```

**Solução Técnica:**

```python
def _text_reflow(text, max_width_px, font, available_height_px):
    """
    Quebrá texto respeitando máxima largura
    Retorna: (wrapped_text, total_height_px)
    """
    lines = []
    current_line = ""
    
    for word in text.split():
        test_line = f"{current_line} {word}".strip()
        bbox = font.getbbox(test_line)
        line_width = bbox[2] - bbox[0]
        
        if line_width > max_width_px and current_line:
            lines.append(current_line)
            current_line = word
        else:
            current_line = test_line
    
    if current_line:
        lines.append(current_line)
    
    line_height = font.getbbox("A")[3] - font.getbbox("A")[1] + 2  # +2px gap
    total_height = len(lines) * line_height
    
    return lines, total_height

# No replace action:
if "replace" in at:
    nt = action.get("new_text", "")
    
    # Calcular reflux
    lines, new_height = _text_reflow(nt, w, fnt, h)
    
    # Desenhar com fundo expandido
    bg_rect = [x0-2, y0-2, x1+2, y0-2+new_height+4]
    draw.rectangle(bg_rect, fill=bg)
    
    # Desenhar linhas
    y_pos = y0
    for line in lines:
        draw.text((x0, y_pos), line, fill=oc, font=fnt)
        y_pos += line_height
    
    # Marcar ação
    draw.rectangle(bg_rect, outline=(29,158,117), width=2)
```

**Esforço Estimado**: 2-3 horas  
**Arquivos a Alterar**: 1 (draft_engine.py)

---

### FEATURE #2: SELEÇÃO MÚLTIPLA 🎨

**Localização:**
- **Frontend**: `src/store/index.ts`
- **Frontend**: `src/components/canvas/StudioCanvas.tsx`
- **Frontend**: `src/components/toolbar/ActionPanel.tsx`

**Solução Técnica:**

```typescript
// store/index.ts - novo estado:
interface StudioStore {
  selectedElements: ArtElement[]  // Array ao invés de single
  addToSelection: (elem: ArtElement) => void
  removeFromSelection: (elemId: string) => void
  clearSelection: () => void
  isMultiSelectMode: boolean
  setMultiSelectMode: (enabled: boolean) => void
}

// StudioCanvas.tsx - lógica de seleção:
rect.on('mousedown', (e) => {
  const isShiftKey = (e.nativeEvent as MouseEvent).shiftKey
  const isCtrlKey = (e.nativeEvent as MouseEvent).ctrlKey
  
  if (isShiftKey || isCtrlKey) {
    // Modo multi-seleção
    const isAlreadySelected = selectedElements.find(el => el.elem_id === elem.elem_id)
    if (isAlreadySelected) {
      removeFromSelection(elem.elem_id)
    } else {
      addToSelection(elem)
    }
    setMultiSelectMode(true)
  } else {
    // Seleção simples
    clearSelection()
    addToSelection(elem)
    setMultiSelectMode(false)
  }
})

// Caixa de seleção com drag:
// Ao detectar drag sem nenhum elemento clicado:
isDrawing.current = true
startPt.current = {x: e.clientX, y: e.clientY}

document.on('mousemove', (e) => {
  if (!isDrawing) return
  const endPt = {x: e.clientX, y: e.clientY}
  const selectionBox = {
    x: Math.min(startPt.x, endPt.x),
    y: Math.min(startPt.y, endPt.y),
    w: Math.abs(endPt.x - startPt.x),
    h: Math.abs(endPt.y - startPt.y)
  }
  
  // Atualizar visualização da caixa
  updateSelectionRect(selectionBox)
  
  // Detectar elementos dentro
  const elementsInBox = elements.filter(el => 
    isElementInBox(el, selectionBox)
  )
  highlightElements(elementsInBox)
})

document.on('mouseup', () => {
  if (isDrawing) {
    isDrawing = false
    // Confirmar seleção dos elementos dentro da caixa
  }
})
```

**ActionPanel adaptado para múltiplos elementos:**
```typescript
// Se múltiplos elementos selecionados, mostrar operações em batch
if (selectedElements.length > 1) {
  return <BatchActionPanel elements={selectedElements} />
}
```

**Esforço Estimado**: 4-5 horas  
**Arquivos a Alterar**: 3 (store/index.ts, StudioCanvas.tsx, ActionPanel.tsx)

---

### FEATURE #7: ROTAÇÃO DO CANVAS 🔄

**Localização:**
- **Frontend**: `src/components/canvas/StudioCanvas.tsx`
- **Frontend**: `src/store/index.ts`

**Solução Técnica:**

```typescript
// store/index.ts:
interface StudioStore {
  canvasRotation: number  // 0, 90, 180, 270
  rotateCanvas: (clockwise: boolean) => void
}

// StudioCanvas.tsx:
const [canvasRotation, setCanvasRotation] = useState(0)

// Aplicar transformação CSS:
<div style={{
  transform: `rotate(${canvasRotation}deg)`,
  transformOrigin: 'center',
  transition: 'transform 0.3s ease',
}}>
  <canvas ref={canvasRef} />
</div>

// Recalcular coordenadas de mouse ao rotacionar:
function rotateCoordinates(x: number, y: number, rotation: number, centerX: number, centerY: number) {
  // Transladar para origem
  let px = x - centerX
  let py = y - centerY
  
  // Rotacionar em radianos
  const rad = (rotation * Math.PI) / 180
  let newX = px * Math.cos(rad) - py * Math.sin(rad)
  let newY = px * Math.sin(rad) + py * Math.cos(rad)
  
  // Transladar de volta
  return {x: newX + centerX, y: newY + centerY}
}

// No handler de mousedown:
const rotatedCoords = rotateCoordinates(
  clickX, clickY, 
  canvasRotation, 
  canvasWidth/2, 
  canvasHeight/2
)
```

**Esforço Estimado**: 2-3 horas  
**Arquivos a Alterar**: 2 (StudioCanvas.tsx, store/index.ts)

---

### FEATURE #6: BOLD TEXT 🔤

**Localização:**
- **Frontend**: `src/components/toolbar/ActionPanel.tsx`
- **Backend**: `backend/engines/draft_engine.py`

**Solução Técnica:**

```typescript
// ActionPanel.tsx:
const [isBold, setIsBold] = useState(false)

// Adicionar botão:
<button 
  onClick={() => setIsBold(!isBold)}
  style={{fontWeight: isBold ? 700 : 400}}
>
  <strong>B</strong>
</button>

// Enviar com action:
const payload = {
  ...actionData,
  is_bold: isBold  // novo campo
}
```

```python
# draft_engine.py:
def _font_bold(size_px):
    """Carrega versão Bold da fonte"""
    for p in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica-Bold.ttc"
    ]:
        try: return ImageFont.truetype(p, max(6, size_px))
        except: pass
    return ImageFont.load_default()

# Na lógica de replace:
is_bold = action.get("is_bold", False)
fnt = _font_bold(fpx) if is_bold else _font(fpx)
```

**Esforço Estimado**: 1-2 horas  
**Arquivos a Alterar**: 2 (ActionPanel.tsx, draft_engine.py)

---

## 🚀 PLANO DE EXECUÇÃO

### Semana 1: Foundation (Bugs + Basics)
- **Dia 1**: Fix BUG #4 (Resize) ✅
- **Dia 2-3**: Implement FEATURE #1 (Zoom)
- **Dia 4-5**: Implement FEATURE #3 (Drag & Drop)

### Semana 2: Core Features
- **Dia 1-2**: Implement FEATURE #5 (Replace + Reflow)
- **Dia 3-4**: Implement FEATURE #2 (Multi-Select)

### Semana 3: Polish
- **Dia 1-2**: Implement FEATURE #7 (Canvas Rotation)
- **Dia 3**: Implement FEATURE #6 (Bold)
- **Dia 4-5**: Testing & Integration

---

## ✅ CHECKLIST DE IMPLEMENTAÇÃO

### Para cada feature, verificar:

- [ ] **Frontend Component** criado/modificado
- [ ] **Store State** adicionado (se necessário)
- [ ] **Backend Route** adicionado/modificado
- [ ] **Type Definitions** atualizadas (TypeScript + Python)
- [ ] **Database Migration** (se necessário)
- [ ] **Unit Tests** escritos
- [ ] **Integration Tests** passando
- [ ] **Error Handling** completo
- [ ] **UX Feedback** (loading states, success messages)
- [ ] **Documentation** atualizada

---

## 📚 REFERÊNCIAS DE CÓDIGO

### Arquivos Críticos:
```
Frontend/
├── src/components/canvas/StudioCanvas.tsx      (Core canvas logic)
├── src/components/toolbar/ActionPanel.tsx      (Action UI)
├── src/store/index.ts                          (Global state - Zustand)
└── src/types/index.ts                          (Type definitions)

Backend/
├── api/routes.py                               (API endpoints)
├── engines/draft_engine.py                     (PDF transformation)
├── engines/detector.py                         (Element detection)
└── domain/models.py                            (Data models)
```

### Dependências Frontend:
- `fabric.js` - Canvas manipulation
- `zustand` - State management
- `typescript` - Type safety

### Dependências Backend:
- `PyMuPDF (fitz)` - PDF processing
- `PIL/Pillow` - Image processing
- `NumPy` - Array operations
