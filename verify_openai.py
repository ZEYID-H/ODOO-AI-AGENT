from dotenv import load_dotenv
from openai import OpenAI
import os

load_dotenv()

print("KEY FOUND:", bool(os.getenv("OPENAI_API_KEY")))

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

response = client.responses.create(
    model=os.getenv("OPENAI_MODEL", "gpt-5.4-mini"),
    input="Reply only with: API works"
)

print(response.output_text)