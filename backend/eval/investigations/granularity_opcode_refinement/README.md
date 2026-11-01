# Granularidade: fragmentação (Buscopan) e fusão (Albendazol)

## Diagnóstico (da rodada anterior, aplicado agora)

Os dois sintomas opostos vêm do mesmo lugar: `_diff_line_words`, que
converte cada opcode não-"equal" do `difflib.SequenceMatcher` (sobre a
lista de palavras de uma linha já pareada corretamente) direto em um
cartão de diferença.

### Buscopan — fragmentação
Original (página 2): `['por','6','a','8','horas.']`
Revisado: `['por','4','a','6','horas','.']`

O número "6" aparece nos dois lados, mas em posições diferentes (era o
primeiro número, passou a ser o segundo). O LCS do difflib ancora nesse
"6" como igual, porque é a maior subsequência comum que encontra —
mesmo sendo, semanticamente, duas ocorrências diferentes. Isso quebra
UM edit em 3 opcodes:
```
equal ['por'] -> ['por']
insert [] -> ['4', 'a']
equal ['6'] -> ['6']
replace ['a', '8', 'horas.'] -> ['horas', '.']
```

### Albendazol — fusão
Linha: `"O albendazol não deve ser..."` -> `"O albendasol deve ser..."`
`['albendazol','não']` e `['albendasol']` não compartilham nenhum token
igual, então o difflib devolve só `replace(['albendazol','não'],
['albendasol'])` — um bloco só, misturando o typo de 1 letra com a
remoção de "não".

## Correção aplicada

Duas funções novas em `pdf_comparator.py`, chamadas por `_diff_line_words`
antes de gerar os cartões:

**`_merge_fragmented_opcodes`** (constante `EQUAL_GAP_MERGE_MAX_TOKENS = 1`):
funde `[não-equal, equal(≤1 token), não-equal]` num único bloco. Resolve
Buscopan sem precisar de nenhuma heurística de similaridade.

**`_split_fused_replace`** (constante `WORD_SUBST_SIM_MIN = 0.6`): dentro
de um bloco "replace" cujo número de palavras difere dos dois lados,
procura a janela contígua do lado mais longo com maior similaridade
média (por palavra, razão de caracteres) contra o lado mais curto; se
essa janela passar do limiar, ela se torna uma substituição e o que
sobra no lado mais longo se torna remoção/adição separada. Calibração:

| Par | similaridade | usado |
|---|---|---|
| albendazol / albendasol | 0.900 | **aceitar como substituição** |
| não / albendasol (sobra) | 0.308 | abaixo do limiar — vira remoção isolada |
| lactose / lactoze | 0.857 | aceitar |
| recomendada / recomedada | 0.952 | aceitar |

## Duas regressões reais encontradas ao rodar a suíte inteira (não escondidas)

A primeira versão de `_split_fused_replace` **quebrou dois casos que
estavam corretos**, porque confundiu "sobra de palavra" com "fragmento
de token cortado pela extração":

1. **Domperidona** (real, não fazia parte do pedido): "30 mg/dia)" ->
   "50 mg/dia)". A extração do PDF revisado separou "mg/dia)" em
   "mg/dia" + ")" (artefato de tokenização, mesmo fenômeno que já
   motivou `WORD_GAP_MERGE_PT`). A primeira versão da correção viu
   `['50','mg/dia']` como boa substituição e sobrou `[')']` — tratado
   como adição independente. Resultado: 1 diferença virou 2, uma delas
   um ")" solto sem sentido.
   ```
   ANTES da 2ª correção: '30 mg/dia)' -> '50 mg/dia' (substituição) + '' -> ')' (adição)
   ```
2. **`par2_mounjaro_dose_17mg`** (gabarito manual já existente): "15" ->
   "17", onde a extração separa "17" em "1"+"7" colados. Mesmo problema:
   ```
   ANTES da 2ª correção: '15' -> '1' (substituição) + '' -> '7' (adição)
   ```
   Isso derrubou `run_manual_pairs` de F1 normalizado 1.00 para 0.89
   (leniente_normalizado) e 0.67 (estrita_normalizada) — queda real,
   capturada rodando a suíte, não escondida.

### Correção da correção
Troquei a guarda (que era só "a sobra é só pontuação?") por uma mais
geral e mais correta: **a sobra está colada (gap quase zero, mesmo
limiar `WORD_GAP_MERGE_PT` que `_join_words` já usa) na janela
casada?** Se sim, é fragmento de um token só, não uma palavra
independente — não faz o split. "não" (Albendazol) fica a um espaço
normal de "albendazol", então o split continua acontecendo; ")" e "7"
ficam colados ao token vizinho, então agora NÃO são mais separados.

## Resultado final (depois da 2ª correção)

| Par | antes do item A | depois do item A | esperado |
|---|---|---|---|
| Buscopan | 7 diferenças | 6 | -1 (fusão de "6 a 8"->"4 a 6") ✅ |
| Albendazol | 5 diferenças | 6 | +1 (separação de typo + remoção) ✅ |
| Domperidona | 5 diferenças | 5 | sem mudança (regressão corrigida) ✅ |
| `run_manual_pairs` (4 pares) | F1 normalizado 1.00 | F1 normalizado 1.00 | sem mudança ✅ |
| `harness` (5 pares sintéticos) | F1 normalizado 1.00 | F1 normalizado 1.00 | sem mudança ✅ |
| pytest | 82 passando + 1 falha conhecida | 86 passando + 1 falha conhecida (4 testes novos) | sem regressão ✅ |

Testes novos em `backend/tests/test_word_diff_granularity.py` cobrem os
4 cenários (fragmentação, fusão, e as duas guardas de regressão).
