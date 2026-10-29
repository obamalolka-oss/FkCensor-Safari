# Авторы, соавторы и источники

**Автор и сопровождающий Safari-версии:** [vibemashia / @obamalolka-oss](https://github.com/obamalolka-oss).

**Соавторы проекта в части списков подмен:** [@Hazzz895](https://github.com/Hazzz895), [@gagayhhad-tech](https://github.com/gagayhhad-tech), [@seuyh](https://github.com/seuyh), [@ink-fun](https://github.com/ink-fun). Их базы дают возможность находить нужные версии записей; конкретные источники и приоритеты перечислены ниже.

## Исходный проект

[Hazzz895/FckCensor](https://github.com/Hazzz895/FckCensor) — исходный проект подмены записей Яндекс Музыки и основа идеи. Лицензия исходного проекта — MIT; уведомление сохранено в [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/FckCensor-MIT.txt).

Указание проекта не означает, что его автор поддерживает эту Safari-версию. Полное происхождение каждой строки локальных файлов по истории Git установить не удалось: исходная рабочая папка не содержит репозитория с историей.

## Публичные базы подмен

Порядок строк соответствует приоритету: первая найденная подмена ID побеждает.

| Приоритет | Автор / проект | Используемые списки |
| --- | --- | --- |
| 1 | [Hazzz895 / FckCensorData](https://github.com/Hazzz895/FckCensorData) | `list_v2.json` |
| 2 | [gagayhhad-tech / ym-liberty-db](https://github.com/gagayhhad-tech/ym-liberty-db) | `list.json` |
| 3 | [seuyh / FckCensorDataAdditional](https://github.com/seuyh/FckCensorDataAdditional) | `list_v2.json` |
| 4 | [ink-fun / FckCensorData](https://github.com/ink-fun/FckCensorData) | `list_v2.json` |
| 5 | [ink-fun / FckCensorData](https://github.com/ink-fun/FckCensorData) | `list.json` |
| 6 | [Hazzz895 / FckCensorData](https://github.com/Hazzz895/FckCensorData) | `list.json` |

Часть аудио из Liberty DB размещена в [naloz/YMliberty на Hugging Face](https://huggingface.co/datasets/naloz/YMliberty). Точные адреса списков находятся в [data/sources.json](data/sources.json). В репозиторий включён снимок адресов и длительностей, не сами аудиофайлы. Исторические commit ID снимка не сохранены; не следует приписывать ему текущие commit ID внешних проектов.

Указание соавторства относится к вкладу списками подмен. Оно не означает участия этих людей в разработке Safari-кода или поддержки ими этой сборки.

## Инструменты

| Инструмент | Назначение | Условия |
| --- | --- | --- |
| [Userscripts / quoid](https://github.com/quoid/userscripts) | Отдельно устанавливаемое расширение Safari | GPL-3.0; исходники расширения в комплект не включены |
| [Node.js](https://nodejs.org/) | Сборка и автоматические тесты | Отдельная среда; применяется её собственная лицензия |
| [Microsoft Playwright](https://github.com/microsoft/playwright) | Необязательная проверка CSP в браузере | Apache-2.0; в комплект не включён |

В установочные скрипты не включены сторонние npm-пакеты. GitHub и Hugging Face используются как внешние хранилища. Записи принадлежат соответствующим правообладателям; авторство списка не равнозначно авторству музыки.
