"""OpenAI Function Calling adapter.

This is the ONLY file that knows OpenAI exists. It is a thin LLM adapter:
it lets the model choose a tool and arguments, runs that choice through
`execute_tool`, and returns a clean dict to the router.

Strict boundaries (do not relax):
    - Business logic is reached ONLY via execute_tool(). This file never imports
      customer_tools / invoice_tools / sales_tools / formatting.
    - Tool resolution/execution never uses eval, getattr on model output, or
      dynamic imports. The registry owns that guarantee; we only pass strings.
    - No fallback / retry / resilience logic here. We raise clean exceptions and
      let router.py decide whether to fall back to the rule-based router.

Chain: User -> Router -> OpenAI Service -> Registry -> Business Logic
"""

import os
import json
from datetime import date

from dotenv import load_dotenv
from openai import OpenAI

from src.agent.tool_schemas import TOOL_SCHEMAS
from src.agent.tool_registry import execute_tool
from src.agent.prompts import SYSTEM_PROMPT

load_dotenv()

# Phase 2 stays focused on Function Calling. AI insights are optional and OFF by
# default; flip to True to enable the second (summary) OpenAI call.
ENABLE_AI_INSIGHTS = False

# The agent's notion of "now", resolved dynamically so relative periods like
# "this month" stay correct over time.
CURRENT_DATE = date.today().isoformat()

_DEFAULT_MODEL = "gpt-4o-mini"

_GUARDRAIL = f"""Today's date is {CURRENT_DATE}.

RULES:
- Never state customer balances, invoice amounts, payment figures, or sales
  numbers from your own knowledge or assumptions.
- For any question about customers, invoices, payments, or sales, you MUST call
  one of the provided tools. A tool result is the only valid source of ERP facts.
- If the request is not about ERP data (e.g. a greeting), reply briefly without
  calling a tool.
- Resolve relative periods such as "this month" using today's date.
"""

_INSIGHT_SYSTEM = """You are summarizing an ERP tool result for a business manager.
Using ONLY the JSON data provided in the tool message, write at most two short
sentences highlighting the key figure(s). Do not invent numbers. Do not output
tables, lists, or markdown headers — a detailed view is shown separately."""

_client_instance: OpenAI | None = None


def is_available() -> bool:
    """True only if an OpenAI API key is configured.

    The router calls this for the 'missing key' fallback branch, so that a
    missing key degrades to rule-based routing without raising.
    """
    return bool(os.getenv("OPENAI_API_KEY"))


def _client() -> OpenAI:
    global _client_instance
    if _client_instance is None:
        _client_instance = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client_instance


def _model() -> str:
    return os.getenv("OPENAI_MODEL", _DEFAULT_MODEL)


def _system_prompt() -> str:
    return f"{SYSTEM_PROMPT}\n\n{_GUARDRAIL}"


def _build_messages(query: str, history: list[dict]) -> list[dict]:
    """system prompt + prior turns (memory) + the new user question.

    Only role/content text is carried from history; UI-only keys (e.g. 'tool')
    are ignored. This is what lets follow-ups like 'show unpaid invoices too'
    resolve against an earlier turn that named the customer.
    """
    messages: list[dict] = [{"role": "system", "content": _system_prompt()}]
    for turn in history:
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": query})
    return messages


def _generate_insight(query: str, tool_call, raw_result: dict) -> str:
    """Second OpenAI call: a 1-2 sentence insight grounded ONLY in raw_result.

    raw_result is passed back as the tool message content, so the model can only
    interpret data it was handed — it never sources ERP facts itself.
    """
    assistant_tool_msg = {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": tool_call.id,
                "type": "function",
                "function": {
                    "name": tool_call.function.name,
                    "arguments": tool_call.function.arguments,
                },
            }
        ],
    }
    tool_result_msg = {
        "role": "tool",
        "tool_call_id": tool_call.id,
        "content": json.dumps(raw_result, default=str),
    }

    response = _client().chat.completions.create(
        model=_model(),
        messages=[
            {"role": "system", "content": _INSIGHT_SYSTEM},
            {"role": "user", "content": query},
            assistant_tool_msg,
            tool_result_msg,
        ],
    )
    content = response.choices[0].message.content
    return content.strip() if content else ""


def run_agent(query: str, history: list[dict] | None = None) -> dict:
    """Run the function-calling loop and return {tool, parameters, result}.

    Raises on any failure (missing key, API/network errors, bad arguments,
    unknown tool). The router catches these and falls back to rule-based routing.
    """
    if not is_available():
        raise RuntimeError("OPENAI_API_KEY is not set.")

    messages = _build_messages(query, history or [])

    first = _client().chat.completions.create(
        model=_model(),
        messages=messages,
        tools=TOOL_SCHEMAS,
        tool_choice="auto",
    )
    message = first.choices[0].message

    # No tool call -> a non-ERP turn (greeting / clarification). The guardrail
    # forbids answering ERP questions this way, so no business data is invented.
    if not message.tool_calls:
        return {
            "tool": "assistant",
            "parameters": {},
            "result": message.content or "",
        }

    tool_call = message.tool_calls[0]
    name = tool_call.function.name
    arguments = json.loads(tool_call.function.arguments or "{}")

    # Sole execution path into business logic.
    raw_result, formatted = execute_tool(name, arguments)

    result = formatted
    if ENABLE_AI_INSIGHTS:
        insight = _generate_insight(query, tool_call, raw_result)
        if insight:
            result = f"{insight}\n\n{formatted}"

    return {
        "tool": name,
        "parameters": arguments,
        "result": result,
    }
