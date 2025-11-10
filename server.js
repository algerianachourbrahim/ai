// server.js - AI Chat Interface + Tools (DB) on Render.com
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, ToolMessage } = require('@langchain/core/messages');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// إعداد قاعدة بيانات SQLite
const db = new sqlite3.Database(':memory:');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    stock INTEGER
  )`);
  const stmt = db.prepare(`INSERT OR IGNORE INTO products (name, stock) VALUES (?, ?)`);
  stmt.run("iPhone 15", 12);
  stmt.run("MacBook Pro 16", 5);
  stmt.run("AirPods Pro", 25);
  stmt.run("Galaxy S24", 8);
  stmt.finalize();
});

// إعداد DeepSeek API (مجاني)
const llm = new ChatOpenAI({
  modelName: 'deepseek-chat', // أو deepseek-reasoner
  openAIApiKey: process.env.DEEPSEEK_API_KEY || 'your-key-here', // احصل من https://platform.deepseek.com
  openAIBaseUrl: 'https://api.deepseek.com/v1',
  temperature: 0.7,
});

// Tool: التحقق من المخزون
const tools = [
  {
    name: 'get_product_stock',
    description: 'احصل على مخزون منتج معين بالاسم',
    func: async (product_name) => {
      return new Promise((resolve) => {
        db.get(`SELECT name, stock FROM products WHERE name LIKE ?`, [`%${product_name}%`], (err, row) => {
          if (err || !row) resolve('المنتج غير موجود في المخزون.');
          else resolve(`المنتج: **${row.name}** | المخزون: **${row.stock} وحدة**`);
        });
      });
    },
    parameters: {
      type: 'object',
      properties: { product_name: { type: 'string' } },
      required: ['product_name']
    }
  }
];

// تنفيذ الـ AI مع Tools
async function runAgent(userMessage) {
  const messages = [
    new HumanMessage({
      content: `أنت مساعد ذكي يتحدث العربية بلهجة جزائرية. استخدم الأدوات عند الحاجة (مثل المخزون). السؤال: ${userMessage}`
    })
  ];

  const response = await llm.invoke(messages, {
    tools: tools.map(t => ({ name: t.name, description: t.description, schema: t.parameters })),
    tool_choice: 'auto'
  });

  if (response.additional_kwargs?.tool_calls) {
    for (const call of response.additional_kwargs.tool_calls) {
      const tool = tools.find(t => t.name === call.name);
      if (tool) {
        const result = await tool.func(call.args.product_name);
        messages.push(new ToolMessage({ content: result, tool_call_id: call.id }));
        const final = await llm.invoke(messages);
        return final.content;
      }
    }
  }
  return response.content;
}

// الصفحة الرئيسية: واجهة الدردشة
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>AI جزائري - @PlumTenDZ</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Tajawal', sans-serif; }
    body { background: linear-gradient(135deg, #0f0c29, #302b63, #24243e); color: #fff; min-height: 100vh; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; background: rgba(255,255,255,0.1); border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    header { background: #00d4ff; color: #000; padding: 15px; text-align: center; font-weight: bold; font-size: 1.3em; }
    #chat { height: 60vh; overflow-y: auto; padding: 20px; background: rgba(0,0,0,0.2); }
    .message { margin: 10px 0; padding: 12px 16px; border-radius: 18px; max-width: 80%; word-wrap: break-word; }
    .user { background: #00d4ff; color: #000; align-self: flex-end; margin-left: auto; border-bottom-right-radius: 5px; }
    .ai { background: #333; color: #0f0; align-self: flex-start; margin-right: auto; border-bottom-left-radius: 5px; }
    .input-area { display: flex; padding: 15px; background: rgba(0,0,0,0.3); }
    input { flex: 1; padding: 12px; border: none; border-radius: 25px; font-size: 1em; outline: none; }
    button { background: #00d4ff; color: #000; border: none; width: 50px; height: 50px; border-radius: 50%; margin-left: 10px; cursor: pointer; font-weight: bold; }
    button:hover { background: #00b0d4; }
    .status { text-align: center; padding: 10px; font-size: 0.9em; color: #0f0; }
    .flag { font-size: 1.5em; margin: 0 5px; }
  </style>
</head>
<body>
  <div class="container">
    <header>AI جزائري <span class="flag">DZ</span> @PlumTenDZ</header>
    <div id="chat">
      <div class="message ai">مرحبا! أنا AI جزائري، اسألني أي شيء... حتى المخزون!</div>
    </div>
    <div class="input-area">
      <input type="text" id="input" placeholder="اكتب سؤالك هنا..." autofocus />
      <button onclick="send()">Send</button>
    </div>
    <div class="status" id="status">جاهز</div>
  </div>

  <script>
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const status = document.getElementById('status');

    async function send() {
      const msg = input.value.trim();
      if (!msg) return;
      addMessage(msg, 'user');
      input.value = '';
      status.textContent = 'جاري التفكير...';

      try {
        const res = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg })
        });
        const data = await res.json();
        addMessage(data.reply || 'خطأ', 'ai');
      } catch (err) {
        addMessage('لا يوجد اتصال بالخادم', 'ai');
      }
      status.textContent = 'جاهز';
    }

    function addMessage(text, sender) {
      const div = document.createElement('div');
      div.className = 'message ' + sender;
      div.innerHTML = text.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>'); // دعم bold
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    input.addEventListener('keypress', e => e.key === 'Enter' && send());
  </script>
</body>
</html>
  `);
});

// API للدردشة
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'اكتب شيئًا' });

  try {
    const reply = await runAgent(message);
    res.json({ reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في الـ AI' });
  }
});

app.listen(PORT, () => {
  console.log(`AI Chat جاهز على: https://your-app.onrender.com`);
});
