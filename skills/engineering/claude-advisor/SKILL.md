---
name: claude-advisor
description: Consulte o Claude Code para uma segunda opinião somente quando o usuário pedir explicitamente.
disable-model-invocation: true
---

# Claude Advisor

Use a CLI `claude` para obter um parecer independente dentro do escopo solicitado.
A autorização existente para a consulta vale durante sua execução.

## Preparar a consulta

O Claude recebe o prompt enviado e o contexto acessível no diretório de trabalho, incluindo `CLAUDE.md` e configurações locais.
Escreva um prompt autocontido com objetivo, escopo, evidências relevantes, restrições, pergunta e saída esperada.
Salve o texto literal em `prompt.md` dentro de um diretório criado com `mktemp -d`.

Inclua uma destas linhas:

```text
Permissão de edição: NÃO. Só inspecione e relate. Não altere nenhum arquivo.
Permissão de edição: SIM. Escopo: <caminhos ou componentes exatos>. Não toque em nada além disso.
```

Use `NÃO` quando o usuário pedir apenas consulta. Use `SIM` quando ele autorizar alterações pelo Claude naquele escopo.
A permissão no prompt delimita a tarefa; o permission mode da CLI controla a execução.

## Executar

Execute no diretório que contém o contexto da tarefa:

```bash
claude -p < /caminho/absoluto/prompt.md
```

Inclua `--model`, `--effort` e `--permission-mode` somente quando seus valores forem definidos pelo usuário.
Use `--add-dir` quando o escopo exigir caminhos adicionais. Para valores omitidos, preserve os padrões da CLI.
Consulte a ajuda local quando precisar validar uma opção explícita. Se houver rejeição, reporte sem substituir o parâmetro.

Acompanhe o processo até encerrar e capture a resposta e o código de saída.
Código `0` indica conclusão; outros códigos indicam falha e tornam parcial qualquer resposta recebida.
Se a CLI estiver ausente ou falhar, reporte o impedimento.

## Verificar e entregar

Verifique as afirmações materiais com evidências da tarefa antes de adotá-las.
Se o Claude alterar arquivos, examine o diff e valide o efeito pertinente.
Diferencie o parecer do Claude das conclusões confirmadas, rejeitadas ou ainda não verificadas.

A consulta termina com o parecer verificado ou a falha identificada.
Entregue o resultado e remova os arquivos temporários criados para a consulta.
