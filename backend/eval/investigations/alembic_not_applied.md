# Achado: alembic presente mas não aplicado

Durante a investigação do Internal Server Error de 2026-10-31 (backend
morrendo no boot por corrida com o container `db`), verificado por
observação direta, sem alterar nada:

- Não existe tabela `alembic_version` em `briefing_db`.
- O schema (10 tabelas: `artwork_processes`, `projects`,
  `comparison_results`, etc.) foi criado por
  `Base.metadata.create_all()`, chamado em `create_tables()`
  (`backend/core/database.py`), disparado no `lifespan` do FastAPI
  (`backend/main.py`) — não por migração.
- O diretório `backend/alembic/` existe no repositório, com uma
  revisão (`alembic heads` → `001 (head)`), mas essa revisão nunca
  foi aplicada a este banco (`alembic current` roda sem erro, mas
  isso só confirma que o alembic *consegue* ler o banco via
  `DATABASE_URL`, não que ele gerencia o schema atual).

Não é um bug — não foi a causa do incidente de boot investigado nesta
sessão. É uma divergência latente: se uma migração alembic real for
escrita e aplicada no futuro (`alembic upgrade head`) sem primeiro
"stampar" o estado atual do banco, ela provavelmente vai tentar criar
tabelas que já existem e falhar. Antes de confiar em alembic para
qualquer mudança futura de schema, alguém precisa decidir entre:
(a) stampar o banco atual na revisão `001` (`alembic stamp 001`) e
passar a usar alembic de fato, ou (b) continuar com `create_all()` e
tratar o diretório `alembic/` como não utilizado.

Nenhuma ação foi tomada sobre isso nesta sessão, por instrução
explícita.
