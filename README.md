# Briefing Studio ✏️
**Plataforma de revisão colaborativa de artes farmacêuticas**

## Rodar com Docker

```bash
cp .env.example .env
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Docs: http://localhost:8000/docs

## Fluxo de uso

1. Criar projeto (SKU, mercado, componente)
2. Upload do PDF de arte
3. Sistema detecta textos, imagens e logos automaticamente
4. Clicar ou arrastar região para selecionar elemento
5. Aplicar ação: Replace / Delete / Move / Resize
6. Gerar draft PDF com as alterações marcadas
7. Baixar briefing para o estúdio

## Regras do sistema

✅ Permitido: substituir texto, deletar elemento, mover posição, redimensionar fonte
🚫 Proibido: alterar cores, vetores, dimensões, Pantone

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Canvas | Fabric.js 5 |
| State | Zustand |
| Backend | FastAPI (Python 3.11) |
| Database | PostgreSQL 16 |
| PDF | PyMuPDF (fitz) |
| Deploy | Docker Compose |
