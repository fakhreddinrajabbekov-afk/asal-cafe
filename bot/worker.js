// Telegram-бот заказов для кафе Asal | cake & coffee
// Работает бесплатно на Cloudflare Workers + KV.
// Переменные окружения: BOT_TOKEN, SECRET, ADMIN_ID. KV-привязка: KV.

// === МЕНЮ: меняйте названия и цены здесь ===
const MENU = [
  { id: "c1", cat: "coffee", name: "Эспрессо", price: 12 },
  { id: "c2", cat: "coffee", name: "Американо", price: 15 },
  { id: "c3", cat: "coffee", name: "Капучино", price: 20 },
  { id: "c4", cat: "coffee", name: "Латте с мёдом", price: 24 },
  { id: "c5", cat: "coffee", name: "Чай", price: 10 },
  { id: "d1", cat: "dessert", name: "Медовик", price: 25 },
  { id: "d2", cat: "dessert", name: "Чизкейк", price: 30 },
  { id: "d3", cat: "dessert", name: "Наполеон", price: 25 },
  { id: "p1", cat: "pizza", name: "Маргарита", price: 45 },
  { id: "p2", cat: "pizza", name: "Пепперони", price: 55 },
  { id: "p3", cat: "pizza", name: "Мясная", price: 60 },
];
const CATS = { coffee: "☕ Кофе", dessert: "🍰 Десерты", pizza: "🍕 Пицца" };
const CUR = "сом.";
const PHONE = "977404040";

const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const getState = async (env, id) =>
  (await env.KV.get("u" + id, "json")) || { cart: {}, step: null };
const saveState = (env, id, s) =>
  env.KV.put("u" + id, JSON.stringify(s), { expirationTtl: 86400 });

const mainKb = (n) => ({
  inline_keyboard: [
    [{ text: CATS.coffee, callback_data: "cat:coffee" }, { text: CATS.dessert, callback_data: "cat:dessert" }],
    [{ text: CATS.pizza, callback_data: "cat:pizza" }],
    [{ text: `🛒 Корзина${n ? " (" + n + ")" : ""}`, callback_data: "cart" }],
  ],
});

const count = (cart) => Object.values(cart).reduce((a, b) => a + b, 0);

function cartText(cart) {
  let total = 0;
  const lines = Object.entries(cart).map(([id, q]) => {
    const m = MENU.find((x) => x.id === id);
    total += m.price * q;
    return `${m.name} × ${q} = ${m.price * q} ${CUR}`;
  });
  return { text: lines.join("\n"), total };
}

const send = (env, chat, text, markup) =>
  tg(env, "sendMessage", { chat_id: chat, text, reply_markup: markup });

async function handle(u, env) {
  // --- нажатия на кнопки ---
  if (u.callback_query) {
    const q = u.callback_query;
    const chat = q.message.chat.id;
    const s = await getState(env, chat);
    const [a, v] = q.data.split(":");
    let note = "";

    if (a === "cat") {
      const items = MENU.filter((m) => m.cat === v).map((m) => [
        { text: `${m.name} — ${m.price} ${CUR}`, callback_data: "add:" + m.id },
      ]);
      items.push([{ text: "⬅️ Назад", callback_data: "menu" }, { text: `🛒 Корзина (${count(s.cart)})`, callback_data: "cart" }]);
      await send(env, chat, `${CATS[v]}\nНажмите на позицию, чтобы добавить:`, { inline_keyboard: items });
    } else if (a === "add") {
      s.cart[v] = (s.cart[v] || 0) + 1;
      await saveState(env, chat, s);
      note = "Добавлено 🍯";
    } else if (a === "menu") {
      await send(env, chat, "Что хотите заказать?", mainKb(count(s.cart)));
    } else if (a === "clear") {
      s.cart = {}; s.step = null;
      await saveState(env, chat, s);
      await send(env, chat, "Корзина очищена.", mainKb(0));
    } else if (a === "cart") {
      if (!count(s.cart)) {
        await send(env, chat, "Корзина пуста. Выберите что-нибудь вкусное:", mainKb(0));
      } else {
        const { text, total } = cartText(s.cart);
        await send(env, chat, `Ваш заказ:\n${text}\n\nИтого: ${total} ${CUR}`, {
          inline_keyboard: [
            [{ text: "✅ Оформить заказ", callback_data: "checkout" }],
            [{ text: "➕ Добавить ещё", callback_data: "menu" }, { text: "🗑 Очистить", callback_data: "clear" }],
          ],
        });
      }
    } else if (a === "checkout") {
      s.step = "phone";
      await saveState(env, chat, s);
      await send(env, chat, "Отправьте номер телефона для связи:", {
        keyboard: [[{ text: "📱 Отправить мой номер", request_contact: true }]],
        resize_keyboard: true, one_time_keyboard: true,
      });
    }
    await tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: note });
    return;
  }

  // --- обычные сообщения ---
  const m = u.message;
  if (!m) return;
  const chat = m.chat.id;
  const s = await getState(env, chat);
  const text = (m.text || "").trim();

  if (text === "/start" || text === "/menu") {
    s.step = null;
    await saveState(env, chat, s);
    await send(env, chat, "Добро пожаловать в Asal | cake & coffee 🐝\nУютное кафе в центре Хорога. Что закажем?", mainKb(count(s.cart)));
    return;
  }
  if (text === "/cake") {
    await send(env, chat, `Торты на заказ принимаем по телефону: ${PHONE}`);
    return;
  }

  if (s.step === "phone" && (m.contact || text)) {
    s.phone = m.contact ? m.contact.phone_number : text;
    s.step = "addr";
    await saveState(env, chat, s);
    await send(env, chat, "Напишите адрес доставки или «самовывоз»:", { remove_keyboard: true });
    return;
  }

  if (s.step === "addr" && text) {
    const { text: items, total } = cartText(s.cart);
    const who = m.from.username ? "@" + m.from.username : m.from.first_name;
    const order =
      `🆕 Новый заказ\n\n${items}\n\nИтого: ${total} ${CUR}\n` +
      `Клиент: ${who}\nТелефон: ${s.phone}\nПолучение: ${text}\nОплата: наличными`;
    await send(env, env.ADMIN_ID, order);
    s.cart = {}; s.step = null;
    await saveState(env, chat, s);
    await send(env, chat, "Спасибо! Заказ принят 🍯 Мы скоро свяжемся с вами.\nНовый заказ: /start");
    return;
  }

  await send(env, chat, "Нажмите /start, чтобы открыть меню.");
}

export default {
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("Asal bot is running");
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.SECRET)
      return new Response("forbidden", { status: 403 });
    try { await handle(await req.json(), env); } catch (e) { console.log(String(e)); }
    return new Response("ok");
  },
};
