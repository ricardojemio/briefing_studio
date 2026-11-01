# Remoção pura não reportada (reflow)

## Pedido original
CLIENT_PRODUCT: um trecho removido não aparece como diferença. Hipótese a verificar:
"tokens colados na extração (spans vs words) ou pareamento de blocos que
descarta bloco sem par."

## O que os 5 arquivos reais do CLIENT_PRODUCT (Nov/2026) mostraram
Comparei `CLIENT_PRODUCT_Original_Carton.pdf` contra as 4 versões `CLIENT_PRODUCT_Alterado_*`
usando `compare_artworks()` diretamente (sem passar pela API), página a
página, com `difflib` sobre o texto bruto de cada página.

- Versões 1–3: só têm texto **adicionado** (marcas d'água "DRAFT — NOT FOR
  PRODUCTION", rótulos de teste) — nada removido.
- Versão 4: tem duas remoções reais — `"Alivio de dolores fuertes"` e
  `" Horas"` — e o comparador **já reportava essas duas corretamente**
  como `text_removed`, mesmo antes de qualquer correção.
- A frase "Fórmula: ... INGREDIENT_A 325 mg, ... INGREDIENT_C 65 mg." é
  **idêntica** nas 5 versões — não é onde a remoção relatada pelo usuário
  aconteceu; meu melhor palpite é que a descrição verbal se referia à
  versão 4 (a única com remoção real) e o texto exato foi lembrado
  aproximadamente.

Como o caso real disponível não reproduzia um "não reportado", construí o
caso sintético mínimo abaixo para isolar a causa a partir da própria
hipótese do pedido.

## Caso sintético mínimo (isola a causa)

Original (3 linhas, y em pontos):
```
y=50   "Linha um de texto"
y=80   "INGREDIENT_A e INGREDIENT_C"
y=110  "Linha tres de texto"
```

Revisado — a linha do meio foi apagada e a linha de baixo **reflui para
cima**, ocupando o espaço da linha apagada (como faria uma ferramenta de
design real re-exportando o PDF; diferente de um patch `redact()+
insert_text()`, que nunca move o que não foi editado):
```
y=50   "Linha um de texto"
y=80   "Linha tres de texto"     ← estava em y=110
```

### Onde a diferença se perde

`compare_artworks` pareia linhas por `_best_iou_match()`, que escolhe o
par com maior **sobreposição geométrica de bbox**, sem olhar o texto. A
linha "Linha tres de texto", ao refluir, pousa exatamente no bbox que
"INGREDIENT_A e INGREDIENT_C" ocupava — IoU próximo de 1.0. O pareador então
casa as duas, geograficamente perfeito, semanticamente errado:

```
# ANTES da correção
text_changed | 'INGREDIENT_A e INGREDIENT_C' -> 'Linha tres de texto'
text_removed | 'Linha tres de texto' -> ''
```

A remoção real ("INGREDIENT_A e INGREDIENT_C") nunca aparece como removida —
ela é relatada como se tivesse sido *editada* para um texto completamente
não relacionado, e a linha que só mudou de posição aparece como removida
no lugar. Do ponto de vista de quem revisa, a remoção real "desaparece".

### Por que o pareamento por span (c7528fc) não sofre disso
O pareamento de spans é usado só para atributos de fonte (tamanho,
estilo, cor) — nunca compara conteúdo de texto, então não há "conteúdo
certo pareado com posição errada" para proteger ali. O problema é
específico do pareamento de **linhas**, que alimenta o diff de texto.

## Correção
`_best_iou_match()` ganhou um gate opcional de similaridade de texto
(`texts_orig`/`texts_rev`/`min_text_sim`), usado só na chamada de
pareamento de linhas (o pareamento de spans continua 100% geométrico,
de propósito). `_text_similarity()` usa razão por palavra primeiro
(robusta contra coincidência de poucos caracteres em frases curtas e não
relacionadas) e cai para razão por caractere só quando não há nenhuma
palavra em comum (ex.: uma linha de uma palavra só, como um número de
dose isolado).

Calibração (ver `LINE_TEXT_SIM_MIN = 0.5` em `pdf_comparator.py`):

| Caso | razão por palavra | razão por caractere | usado |
|---|---|---|---|
| linhas não relacionadas (o bug) | 0.000 | 0.341 | **rejeitar** |
| "paracetamol 750 mg" → "755 mg" | 0.667 | 0.944 | aceitar |
| frase do Mounjaro (dose) | 0.875 | 0.972 | aceitar |
| "farmacêutico" → "farmacêutica" | 0.875 | 0.981 | aceitar |
| "750" → "755" (linha de 1 token) | 0 (sem palavras) | 0.667 | aceitar |

### Depois da correção
```
text_removed | 'INGREDIENT_A e INGREDIENT_C' -> ''
text_removed | 'Linha tres de texto' -> ''
text_added   | '' -> 'Linha tres de texto'
```
A remoção real agora aparece. Como efeito colateral aceito (não é o bug
que este item pede para corrigir): a linha que só mudou de posição, sem
mudar de conteúdo, aparece como remover+adicionar em vez de "sem
diferença" — detectar "mesma linha, só moveu" é um refinamento futuro,
não coberto aqui.

## Verificação de não regressão
- `python -m eval.run_manual_pairs`: os 4 pares reais continuam com
  F1 normalizado = 1.00 em todos, idêntico a antes da correção.
- `python -m eval.harness` (5 pares sintéticos): agregado idêntico,
  F1 normalizado = 1.00.
- `pytest`: 79 + 1 falha conhecida → 81 + 1 falha conhecida (2 testes
  novos em `tests/test_line_removal_reflow.py`, ambos passando).
