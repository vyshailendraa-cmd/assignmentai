# AssignmentAI

AssignmentAI is a React/Vite web app that turns a university assignment brief and optional CSV dataset into a structured draft report using the OpenAI Responses API.

## Run locally

```bash
npm install
cp .env.example .env.local
# Add your OpenAI API key to .env.local
npm run dev
```

For local testing of the Vercel API route, use Vercel CLI:

```bash
npm install -g vercel
vercel dev
```

## Deploy to Vercel

1. Upload this folder to a new GitHub repository.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Add an environment variable named `OPENAI_API_KEY`.
4. Optionally add `OPENAI_MODEL` (default: `gpt-4.1-mini`).
5. Click **Deploy**.
6. Copy the Vercel production URL into the Devpost **Try it out** field.

Do not put the OpenAI key in frontend code or in a variable beginning with `VITE_`.
