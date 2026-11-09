# "Código tem fp=2 e P=0.50 ao mesmo tempo que fp=0 e P=0.50" — diagnóstico

## Resultado do diagnóstico: o export e o código já estavam consistentes

Antes de mudar qualquer coisa, recomputei precisão/revocação a partir de tp/fp/fn de
**cada linha** de `backend/eval/exports/altered_pairs_artigo_por_categoria.csv` (script abaixo) e
comparei a soma de tp/fp/fn por categoria contra `altered_pairs_artigo_agregado.csv`, nas 4
métricas:

```python
import csv
for row in csv.DictReader(open("altered_pairs_artigo_por_categoria.csv")):
    tp, fp, fn = int(row["tp"]), int(row["fp"]), int(row["fn"])
    p = round(tp/(tp+fp), 3) if (tp+fp) else 0.0
    assert abs(p - float(row["precision"])) < 1e-6   # nunca falhou — 16 linhas, 0 mismatch
```

**Nenhuma linha do CSV real falhou.** Toda linha tem `precision == tp/(tp+fp)` e
`recall == tp/(tp+fn)` exatamente, e a soma de tp/fp/fn por categoria bate com o agregado nas
4 métricas (confirmado também contra o relatório completo, com CLIENT_PRODUCT_2 incluso, nas 4 métricas:
`lenient` 32/16/8, `lenient_normalized` 33/15/7, `strict` 23/25/17, `strict_normalized` 32/16/8 —
soma por categoria == agregado em todas).

**A linha "Código lenient: tp=2 fp=2 fn=0 (P=0,50)" e "Código strict_normalized: tp=2 fp=0 fn=0
(P=0,50)" nunca existiram no export.** O CSV real tem:

```
Código,lenient,1.0,1.0,1.0,2,0,0
Código,strict,0.5,0.5,0.5,1,1,1
Código,strict_normalized,1.0,1.0,1.0,2,0,0
```

Essas duas linhas (`tp=2,fp=2,fn=0,P=0.50` e `tp=2,fp=0,fn=0,P=0.50`) vieram da **tabela que eu
mesmo escrevi à mão** na resposta anterior ao resumir o CSV em markdown — um erro de transcrição
meu (copiei valores de uma saída de uma rodada anterior, sem `only_products` filtrado, que incluía
o CLIENT_PRODUCT_2 Foil, e ainda errei dois números ao digitar). Peço desculpa pelo erro — o pipeline em si
nunca gerou um `P` inconsistente com `tp/fp`; `_prf1()` sempre computa os três a partir do mesmo
`(tp, fp, fn)` e não há como o `_fmt()`/CSV discordarem entre si.

## De onde vinha o `fp=2` em Código que eu mostrei antes

A tabela errada veio de uma rodada SEM filtro `only_products` (os 5 pares do artigo + CLIENT_PRODUCT_2 Foil
juntos no mesmo `by_category`). Nessa rodada, CLIENT_PRODUCT_2 Foil tem 2 detecções tipo `ean_changed`
(`'62000000217709'→'62000000'` nas páginas 1 e 2) que **não correspondem a nenhuma mudança
esperada** — são FP genuínos, categorizados como "Código" pelo lado detectado
(`_category(d)`/`_taxonomy()`), e CodigoMS sozinho não gera nenhum FP em Código. Juntos (CLIENT_PRODUCT_2 +
CodigoMS no mesmo bucket): `fp[Código] = 0 (CodigoMS) + 2 (CLIENT_PRODUCT_2) = 2`, `tp[Código] = 2
(CodigoMS) + 0 (CLIENT_PRODUCT_2) = 2` → `P = 2/4 = 0.50`. Essa conta está certa — é a tabela que eu
reescrevi à mão depois que ficou errada (troquei P=1.00 por P=0.50 em duas linhas que não tinham
CLIENT_PRODUCT_2 nenhum). O **export comitado (`altered_pairs_artigo_*`) nunca incluiu CLIENT_PRODUCT_2** — usa
`only_products` restrito aos 5 pares do artigo — então esse fp=2 nunca apareceu lá.

## Tabela completa por casamento: categoria esperada, categoria detectada, bucket (5 pares do artigo)

Gerada rodando `run()` com `only_products={Domperidona,Buscopan,Albendazol,SaldeFruta,CodigoMS}`
e logando, para cada par e métrica, exatamente qual bucket cada TP/FP/FN incrementa:

```
CodigoMS, lenient (kind=exact):
  TP exp=Código det=Código match=True  -> tp[Código]+=1
  TP exp=Código det=Texto  match=False -> tp[Código]+=1   (TP conta na categoria ESPERADA
                                                             mesmo com texto/categoria detectada
                                                             diferente — ver REGRA abaixo)
CodigoMS, strict (kind=exact, exige texto):
  TP exp=Código det=Código match=True  -> tp[Código]+=1
  TP exp=Código det=Texto  match=False -> DEMOTED: fp[Código]+=1, fn[Código]+=1
                                           (demovido por TEXTO não bater, não por categoria)
CodigoMS: nenhuma linha "FP det=Código" em nenhuma das 4 métricas.
```

(tabela completa, par a par, nos 4 arquivos JSON gerados durante o diagnóstico — resumo: as
únicas categorias com FP genuíno no conjunto do artigo são Medida/dose (Albendazol, 1 detecção
extra sem par) e Texto (Sal de Fruta, o artefato `''→'.'`); Código nunca tem FP genuíno nos 5
pares do artigo, só a demoção estrita do próprio TP.)

## Por que isso nunca quebra "por construção" — e onde PODERIA quebrar

`overall[m]` é literalmente `_prf1(sum(by_category[m]["tp"].values()), sum(...fp...), sum(...fn...))`
— soma dos MESMOS dicionários que alimentam a tabela por categoria, então a igualdade
soma-por-categoria == agregado é garantida pela própria construção do código, não por sorte.

O único jeito de isso quebrar seria se o conjunto de categorias usado para montar a tabela por
categoria (`categories = sorted(set(by_category["lenient"]["tp"]) | ...)`) **não cobrisse** uma
categoria que só aparece em outra métrica — hoje isso não acontece porque toda categoria vem de um
conjunto fechado de 4 valores fixos (Texto/Medida-dose/Código/Imagem), então qualquer métrica que
gere alguma categoria já a gera também em `lenient` (basta um TP). Mas é um invariante implícito,
não garantido estruturalmente — por isso o item 3 (teste automatizado) passa a checar isso de
verdade a cada rodada, em vez de confiar na coincidência do conjunto fechado de categorias.
