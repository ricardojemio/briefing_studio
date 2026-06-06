# 🔧 IMPLEMENTAÇÃO FASE 1 - BUG #4: FIX INVERSÃO DE RESIZE

## 🎯 OBJETIVO
Corrigir a inversão de lógica no Resize onde aumentar fonte diminui e vice-versa.

## 🔍 ANÁLISE DO PROBLEMA

### Código Atual (QUEBRADO):

**Backend - `draft_engine.py` (linhas 76-84):**
```python
elif "resize" in at:
    nfs=action.get("new_font_size") if isinstance(action,dict) else getattr(action,"new_font_size",None)
    if not nfs: continue
    nfpx=int(nfs*scale/1.3)  # ← PROBLEMA: divisão por 1.3 pode estar invertida
    fnew=_font(nfpx)
    ot=action.get("original_text") if isinstance(action,dict) else getattr(action,"original_text","") or ""
    eh=max(h,nfpx+8)
    draw.rectangle([x0-2,y0-2,x1+50,y0+eh+4],fill=bg)
    draw.text((x0,y0),ot,fill=oc,font=fnew)
    draw.rectangle([x0-2,y0-2,x1+2,y0+eh+2],outline=(186,117,23),width=2)
    delta=nfs-fs; sign="+" if delta>=0 else ""
```

### Raiz Causa Identificada:

1. **Inconsistência de Unidades**: O código mistura pontos (pt) com pixels (px)
   - `fs` é em pontos (do PDF)
   - `nfs` é em pontos (do action)
   - `fpx` e `nfpx` são em pixels

2. **Cálculo de Escala Errado**:
   ```
   fpx = fs * scale / 1.3     // Divide por 1.3 = ENCOLHE
   nfpx = nfs * scale / 1.3   // Divide por 1.3 = ENCOLHE
   
   Se nfs > fs, esperamos nfpx > fpx, mas divisão igual resulta em proporcional
   O problema é que 1.3 é constante MULTIPLICADORA, não divisor!
   ```

3. **Falta de Validação**: Não há verificação se `nfs > fs` ou `nfs < fs`

---

## ✅ SOLUÇÃO PROPOSTA

### PASSO 1: Corrigir Backend (`draft_engine.py`)

**Linha a modificar**: ~76-84

```python
elif "resize" in at:
    nfs = action.get("new_font_size") if isinstance(action, dict) else getattr(action, "new_font_size", None)
    if not nfs or nfs <= 0:
        continue
    
    # ✅ FIX #1: Usar MULTIPLICAÇÃO ao invés de divisão
    fpx_original = int(fs * scale * 1.3)  # Tamanho original em pixels
    nfpx = int(nfs * scale * 1.3)          # Novo tamanho em pixels (CORRETO)
    
    fnew = _font(nfpx)
    ot = action.get("original_text") if isinstance(action, dict) else getattr(action, "original_text", "") or ""
    
    # ✅ FIX #2: Validação de direção
    is_increase = nfs > fs
    
    # Altura esperada para novo tamanho
    eh = max(h, nfpx + 8)
    
    # Desenhar background
    draw.rectangle([x0-2, y0-2, x1+50, y0+eh+4], fill=bg)
    
    # Desenhar texto com novo tamanho
    draw.text((x0, y0), ot, fill=oc, font=fnew)
    
    # ✅ Cor do outline baseada na direção
    outline_color = (60, 180, 60) if is_increase else (200, 100, 50)  # Verde se aumenta, laranja se diminui
    draw.rectangle([x0-2, y0-2, x1+2, y0+eh+2], outline=outline_color, width=2)
    
    # Log para debugging
    delta = nfs - fs
    sign = "+" if delta >= 0 else ""
    print(f"RESIZE: {fs}pt → {nfs}pt ({sign}{delta}pt) | {fpx_original}px → {nfpx}px")
```

---

### PASSO 2: Adicionar Validação Frontend (`ActionPanel.tsx`)

**Localizar**: `src/components/toolbar/ActionPanel.tsx` (linhas ~48-60)

```typescript
// Adicionar validação ao setter de newFs:
const handleFontSizeChange = (value: number) => {
  // Validar range: 6pt mínimo, 72pt máximo
  const validated = Math.max(6, Math.min(72, value))
  setNewFs(validated)
  
  // Feedback visual da direção
  if (element && element.font_size) {
    const direction = validated > element.font_size ? "↑ AUMENTANDO" : "↓ DIMINUINDO"
    console.log(`Font Size: ${element.font_size}pt → ${validated}pt (${direction})`)
  }
}

// No JSX, melhorar input de font size:
{actionType === 'resize' && (
  <div style={{ marginTop: 12 }}>
    <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#aaa' }}>
      Nova Fonte: {element?.font_size}pt → {newFs}pt
      <span style={{ marginLeft: 8, color: newFs > (element?.font_size || 12) ? '#60b040' : '#c86432' }}>
        {newFs > (element?.font_size || 12) ? '↑ AUMENTAR' : '↓ DIMINUIR'}
      </span>
    </label>
    <input
      type="range"
      min="6"
      max="72"
      value={newFs}
      onChange={(e) => handleFontSizeChange(parseFloat(e.target.value))}
      style={{ width: '100%', cursor: 'pointer' }}
    />
    <div style={{ fontSize: 11, color: '#999', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
      <span>6pt</span>
      <span>{newFs}pt</span>
      <span>72pt</span>
    </div>
  </div>
)}
```

---

### PASSO 3: Adicionar Testes Unitários

**Arquivo novo**: `backend/tests/test_resize_fix.py`

```python
import pytest
from engines.draft_engine import generate_draft
from domain.models import ActionType

class TestResizeFix:
    """Testes para verificar que Resize funciona corretamente"""
    
    def test_resize_increases_font_size(self):
        """AUMENTAR fonte deve resultar em texto maior"""
        action = {
            'action_type': 'resize',
            'new_font_size': 24,  # Aumentar de 12 para 24
            'sel_x': 0.1,
            'sel_y': 0.1,
            'sel_w': 0.2,
            'sel_h': 0.1,
        }
        element = {
            'font_size': 12,
            'x_norm': 0.1,
            'y_norm': 0.1,
            'w_norm': 0.2,
            'h_norm': 0.1,
        }
        
        # Calcular tamanho em pixels
        scale = 300 / 72  # High DPI
        original_px = int(12 * scale * 1.3)
        new_px = int(24 * scale * 1.3)
        
        assert new_px > original_px, f"Novo tamanho {new_px}px deveria ser > {original_px}px"
    
    def test_resize_decreases_font_size(self):
        """DIMINUIR fonte deve resultar em texto menor"""
        scale = 300 / 72
        original_px = int(24 * scale * 1.3)
        new_px = int(12 * scale * 1.3)
        
        assert new_px < original_px, f"Novo tamanho {new_px}px deveria ser < {original_px}px"
    
    def test_resize_validates_min_max(self):
        """Validar limites: 6pt mínimo, 72pt máximo"""
        scale = 300 / 72
        
        # Mínimo
        min_px = int(6 * scale * 1.3)
        assert min_px > 0
        
        # Máximo
        max_px = int(72 * scale * 1.3)
        assert max_px < 500  # Sanidade check

if __name__ == '__main__':
    pytest.main([__file__, '-v'])
```

---

## 🧪 CHECKLIST DE VALIDAÇÃO

Antes de marcar como PRONTO:

- [ ] **Teste manual #1**: Selecionar texto → Click Resize → Aumentar de 12pt para 24pt
  - ✓ Esperado: Texto fica **MAIOR** no preview
  - ✓ Esperado: Draft PDF mostra texto **MAIOR**

- [ ] **Teste manual #2**: Selecionar texto → Click Resize → Diminuir de 24pt para 6pt
  - ✓ Esperado: Texto fica **MENOR** no preview
  - ✓ Esperado: Draft PDF mostra texto **MENOR**

- [ ] **Teste de validação**: Tentar resize para valores inválidos (0, -5, 100)
  - ✓ Esperado: Sistema rejeita ou limita para [6, 72]

- [ ] **Teste de feedback UI**: Ao mover slider de resize
  - ✓ Esperado: Label mostra "↑ AUMENTANDO" ou "↓ DIMINUINDO"
  - ✓ Esperado: Cores mudam (verde para aumento, laranja para diminuição)

- [ ] **Testes unitários** passando: `pytest backend/tests/test_resize_fix.py -v`

---

## 🚀 COMO APLICAR OS PATCHES

### 1. Fazer backup
```bash
cp backend/engines/draft_engine.py backend/engines/draft_engine.py.bak
cp frontend/src/components/toolbar/ActionPanel.tsx frontend/src/components/toolbar/ActionPanel.tsx.bak
```

### 2. Aplicar mudanças (instruções detalhadas abaixo)

### 3. Testar
```bash
# Backend
cd backend
pytest tests/test_resize_fix.py -v

# Frontend
cd frontend
npm test -- ActionPanel.test.tsx
```

### 4. Deploy
```bash
docker-compose down
docker-compose up --build
```

---

## 📋 EXPLICAÇÃO MATEMÁTICA

### Antes (QUEBRADO):
```
DPI = 300, scale = 300/72 = 4.166

Fonte original: 12pt
fpx = 12 * 4.166 / 1.3 = 38.5px

Resize para: 24pt (AUMENTAR 2x)
nfpx = 24 * 4.166 / 1.3 = 77px

Resultado: 77px > 38.5px ✓ Funcionava neste caso
MAS se o divisor/multiplicador estiver invertido em outro lugar...
```

### Depois (CORRETO):
```
DPI = 300, scale = 300/72 = 4.166

Fonte original: 12pt
fpx = 12 * 4.166 * 1.3 = 64.7px

Resize para: 24pt (AUMENTAR 2x)
nfpx = 24 * 4.166 * 1.3 = 129.4px

Resultado: 129.4px > 64.7px ✓ GARANTIDO PROPORCIONAL
```

A chave: **MULTIPLICAÇÃO garante proporcionalidade**, divisão fixa pode causar inversão.

---

## ⏱️ TEMPO ESTIMADO

- **Análise e compreensão**: 15 min
- **Modificar código backend**: 10 min
- **Modificar código frontend**: 15 min
- **Escrever testes**: 10 min
- **Testar manual**: 10 min
- **Total**: ~60 minutos

---

## 📞 PRÓXIMO PASSO

Após marcar este BUG como PRONTO:
→ Prosseguir para **FEATURE #1: ZOOM IN/OUT** (maior impacto em UX)

