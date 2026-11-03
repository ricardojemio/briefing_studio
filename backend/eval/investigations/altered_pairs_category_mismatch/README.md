# Pares alterados: Medida/dose com tp=1 (esperado até 8), Imagem em 0,00 na estrita

## Como o harness atribui categoria hoje (antes de qualquer mudança)

`run_altered_pairs.py` converte cada entrada do gabarito (`gabarito_alteracoes.json`, campo
`"tipo"`) para o formato esperado pelo harness via `_to_expected()`, que roda `_internal_type_for()`
para decidir o `type` interno (`text_changed`, `text_removed`, `visual`, `ean_changed`) usado no
match por IoU+tipo+página. Até aqui, nenhuma categoria é atribuída ainda — ela só entra na hora de
**relatar** por categoria (Texto / Medida-dose / Código / Imagem), via `_category(d)`:

```python
def _category(d: dict) -> str:
    _, subtipo = _taxonomy(d)   # pdf_comparator._taxonomy()
    ...
```

`_category()` chama `pdf_comparator._taxonomy()` — a MESMA função usada para classificar a saída
real do comparador (frontend, `harness.by_subtipo`). Para um diff `type="text_changed"`,
`_taxonomy()` decide entre "Substituição" e "Medida/dose" rodando `_is_measure_text()` no texto do
PRÓPRIO diff:

```python
MEASURE_RE = re.compile(r'^\d+([.,]\d+)?\s*(mg|mcg|µg|ml|g|kg|%|ui|mmhg)?\.?$', re.IGNORECASE)
```

**O bug (antes da correção deste item): essa função rodava tanto no lado DETECTADO quanto no lado
ESPERADO** — e `run_altered_pairs.py` usava `_category(t["expected"])` para contar o TP, aplicando
`_is_measure_text()` ao texto do GABARITO, não ao texto que o comparador realmente produziu.

## Tabela: esperado → categoria atribuída → categoria do diff detectado que casou (4 pares públicos)

TPs de `lenient_normalized` (bbox+tipo+página batem, texto ainda não comparado) para os 4 pares do
artigo. "Categoria (ANTES)" é o que `_category(t["expected"])` dava; "categoria detectada" é o que
`_category(t["detected"])` dá hoje (saída real do comparador):

| Par | Esperado (gabarito) | tipo gabarito | Categoria (ANTES, bug) | Categoria detectada |
|---|---|---|---|---|
| Domperidona | `'brancos'→''` | ERRO_ORTOGRAFICO* | Texto | Texto |
| Domperidona | `'adolescentes'→'adolecentes'` | ERRO_ORTOGRAFICO | Texto | Texto |
| Domperidona | `'embalagens'→'embalagems'` | ERRO_ORTOGRAFICO | Texto | Texto |
| Domperidona | `'30 mg/dia'→'50 mg/dia'` | SUBSTITUICAO_NUMERO | **Texto** | Texto |
| Domperidona | `'(area em branco)'→'caixa laranja...'` | ALTERACAO_VISUAL | Imagem | Imagem |
| Buscopan | `'pelo menos'→''` | REMOCAO | Texto | Texto |
| Buscopan | `'recomendada'→'recomedada'` | ERRO_ORTOGRAFICO | Texto | Texto |
| Buscopan | `'20 comprimidos'→'30 comprimidos'` | SUBSTITUICAO_NUMERO | **Texto** | **Medida/dose** |
| Buscopan | `'lactose'→'lactoze'` | ERRO_ORTOGRAFICO | Texto | Texto |
| Buscopan | `'6 a 8 horas'→'4 a 6 horas'` | SUBSTITUICAO_NUMERO | **Texto** | Texto |
| Buscopan | `'(area em branco)'→'caixa laranja...'` | ALTERACAO_VISUAL | Imagem | Imagem |
| Albendazol | `'durante 3 dias'→'durante 5 dias'` | SUBSTITUICAO_NUMERO | **Texto** | **Medida/dose** |
| Albendazol | `'Embalagem'→'Embalajem'` | ERRO_ORTOGRAFICO | Texto | Texto |
| Albendazol | `'não'→''` | REMOCAO | Texto | Texto |
| Albendazol | `'2 a 12 anos'→'3 a 12 anos'` | SUBSTITUICAO_NUMERO | **Texto** | **Medida/dose** |
| Albendazol | `'albendazol'→'albendasol'` | ERRO_ORTOGRAFICO | Texto | Texto |
| Albendazol | `'(area em branco)'→'caixa laranja...'` | ALTERACAO_VISUAL | Imagem | Imagem |
| SaldeFruta | `'12 anos'→'10 anos'` | SUBSTITUICAO_NUMERO | **Texto** | **Medida/dose** |
| SaldeFruta | `'efervescência'→'efervescencia'` | ERRO_ORTOGRAFICO | Texto | Texto |
| SaldeFruta | `'14 dias'→'7 dias'` | SUBSTITUICAO_NUMERO | **Texto** | **Medida/dose** |
| SaldeFruta | `'750 mg'→'570 mg'` | SUBSTITUICAO_NUMERO | **Medida/dose** | Medida/dose |
| SaldeFruta | `'necessário'→'necesário'` | ERRO_ORTOGRAFICO | Texto | Texto |
| SaldeFruta | `'(area em branco)'→'caixa laranja...'` | ALTERACAO_VISUAL | Imagem | Imagem |

(*`'brancos'→''` está rotulado `ERRO_ORTOGRAFICO` no gabarito, não `REMOCAO`, apesar do texto
revisado vazio — mantido como está, gabarito não foi tocado.)

**Resultado: 8 `SUBSTITUICAO_NUMERO`, só 1 (`'750 mg'`) classificado "Medida/dose" ANTES da
correção** — porque `MEASURE_RE` só reconhece um número isolado seguido (opcionalmente) de uma
unidade curta da lista fixa (`mg|mcg|µg|ml|g|kg|%|ui|mmhg`), e só isso: nada de palavras ao redor.

## Por que só 1 de 8 batia o regex

Lista completa dos 8 `SUBSTITUICAO_NUMERO` do gabarito (texto do GABARITO, nível de frase):

```
'30 mg/dia'      -> '50 mg/dia'       # unidade "mg/dia" não está na lista de MEASURE_RE
'6 a 8 horas'    -> '4 a 6 horas'     # frase multi-palavra, não bate ^\d+...$
'20 comprimidos' -> '30 comprimidos'  # "comprimidos" não é unidade reconhecida
'durante 3 dias' -> 'durante 5 dias'  # não começa com dígito
'2 a 12 anos'    -> '3 a 12 anos'     # frase multi-palavra
'750 mg'         -> '570 mg'          # ✓ bate: número + unidade reconhecida, nada mais
'12 anos'        -> '10 anos'         # "anos" não é unidade reconhecida
'14 dias'        -> '7 dias'          # "dias" não é unidade reconhecida
```

Mas o diff DETECTADO (o que `compare_artworks` realmente produz) para 5 desses 8 já isola
corretamente só o número (`'20'→'30'`, `'3'→'5'`, `'2'→'3'`, `'12'→'10'`, `'14'→'7'`) — e esse
texto isolado BATE `MEASURE_RE` perfeitamente (número puro, sem unidade). Os 2 que continuam como
frase completa nos dois lados (`'30 mg/dia'`, `'6 a 8 horas'`) são onde a lógica de granularidade
do item A (merge/split de opcodes) legitimamente mantém a frase inteira como um diff só — não é
um bug novo, é o comportamento documentado em
`investigations/granularity_opcode_refinement/README.md`.

**Ou seja: o comparador já acerta a granularidade/classificação em 5 dos 8 casos — o relatório é
que estava medindo a categoria no lado errado (texto do gabarito, nível de frase) em vez do lado
que o comparador realmente produziu ou do próprio rótulo `"tipo"` do gabarito.**

## Correção aplicada (item 2, sem tocar `gabarito_alteracoes.json` nem `MEASURE_RE`)

`run_altered_pairs.py` agora deriva a categoria ESPERADA direto do campo `"tipo"` do gabarito
(`_expected_category_from_gabarito_tipo`), não mais via `_taxonomy()` no texto do gabarito:

```
SUBSTITUICAO_NUMERO -> Medida/dose
ERRO_ORTOGRAFICO    -> Texto
REMOCAO             -> Texto
ALTERACAO_VISUAL     -> Imagem
```

O lado DETECTADO continua usando `_category()`/`_taxonomy()` (o que o comparador realmente
produziu) — para falsos positivos e para a matriz de confusão. Quando as duas categorias
divergem num TP (ex. `'30 mg/dia'→'50 mg/dia'`: gabarito diz Medida/dose, comparador detecta como
Texto/Substituição porque manteve a frase inteira), isso é reportado separadamente como matriz de
confusão — não é escondido nem corrigido silenciosamente.
