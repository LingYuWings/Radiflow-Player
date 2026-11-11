---
description: "Use when the assistant is about to end the turn, send the final reply, close the current request, or wrap up completed work. Before ending, it must call askQuestions to confirm whether the user wants to continue, start a new plan, or explicitly allow ending. 仅在本轮请求原本将要结束时生效，不用于中间步骤。"
---

# Closing Gate For askQuestions

当且仅当本轮请求已经完成、并且你原本将要结束本轮回复时，必须先调用 askQuestions。

这里的 askQuestions 指用于向用户发出简短澄清或收尾确认问题的提问工具。

askQuestions 的提问目的只有一个：确认用户是否要继续当前话题、开始新的计划，或明确允许结束。

只有在以下条件同时满足时，才调用 askQuestions：

1. 你已经完成了当前请求要求的全部工作；
2. 你正准备发送本轮的最终回复；
3. 你在本轮中不再计划继续读取、搜索、编辑文件、运行命令或调用其他工具；
4. 你在本轮收尾阶段尚未调用过 askQuestions。

不要在以下场景调用 askQuestions：

1. 中间进度汇报时；
2. 还在分析、搜索、读取文件、编写代码、修复错误或运行测试时；
3. 只是完成了某个子步骤，但整个用户请求尚未完成时；
4. 你已经知道下一步应该直接继续执行什么时。

如果还有明确的下一步可执行动作，直接继续执行，不要提问。
先交付用户当前请求的主结果，再在真正收尾前调用 askQuestions。
即使前面已经调用过 askQuestions，在没得到明确允许结束的回答之前，也不要把当前请求视为已结束，需要继续调用 askQuestions。

在 askQuestions 中，问题应明确询问以下之一：

1. 是否继续当前任务；
2. 是否允许结束当前请求。
3. 让用户输入是否有别的后续补充需求。

推荐提问模板：

- 当前请求已完成。你要继续当前任务、开始新的计划，还是允许结束当前请求？是否有其他后续补充需求？

提问数量限制：

- askQuestions 在收尾阶段只用于提出一个收尾确认问题。
- 不要把实现细节澄清、额外建议筛选、偏好收集等其他问题混在同一次 askQuestions 里。

除非用户明确表示“可以结束”“不用继续”“没有其他需求”或同等含义，否则不要把当前请求视为已结束。

示例：

- 应当触发：已经完成全部代码修改、验证和结果说明，且下一步不再读取、搜索、编辑或运行工具，此时在最终收尾前调用 askQuestions。
- 不应触发：正在汇报进度、刚完成一个子步骤、准备继续修复错误、准备继续跑测试、或已经知道下一步该直接执行什么。
- 不应触发：已经发过收尾确认问题，但用户尚未明确表示允许结束。
- 用户若回答“继续当前任务”或提出新的计划，必须立即恢复正常执行；只有下一次再次满足收尾条件时，才可以再次调用 askQuestions。

Only call the askQuestions tool when all of the following are true:

1. You have completed the full user request;
2. You are about to send the final reply for this turn;
3. You do not plan to read, search, edit, run commands, or use any other tools anymore in this turn;
4. You have not already called askQuestions during the closing phase of this turn.

Do not call askQuestions during progress updates, investigation, editing, debugging, testing, or any intermediate step.
If there is still an actionable next step, continue working instead of asking.

Use askQuestions only as the final closing gate before ending the request.
Do not treat the request as finished unless the user explicitly indicates that ending is allowed.