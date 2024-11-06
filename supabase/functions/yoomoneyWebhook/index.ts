import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { serve } from "https://deno.land/std@0.136.0/http/server.ts";

// Настраиваем пул подключений к базе данных
const pool = new Pool(
    {
      database: "postgres",
      hostname: "aws-0-eu-central-1.pooler.supabase.com",
      user: "postgres.bpfvpifhkxvuykrmtdyv",
      port: 6543,
      password: Deno.env.get("DB_PASSWORD"),
    },
    1
);

// Функция для вычисления SHA-1 хеша
async function calculateSha1Hash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-1", encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Основная функция для обработки вебхука
serve(async (req: Request) => {
  console.log("Сервер запущен");

  if (req.method !== "POST") {
    return new Response("Метод не поддерживается", { status: 405 });
  }

  try {
    // Извлекаем данные из запроса в формате FormData и преобразуем в объект
    const formData = await req.formData();
    const data = Object.fromEntries(formData.entries());

    // Логируем данные для отладки
    console.log("Полученные данные:", data);

    // Извлекаем нужные поля или задаем значение null, если поле отсутствует
    const amount = data.amount ? parseFloat(data.amount) : null;
    const sender = data.sender || null;
    const operation_id = data.operation_id || null;
    const datetime = data.datetime || null;
    const notification_type = data.notification_type || null;
    const sha1_hash = data.sha1_hash || null;
    const currency = data.currency || null;
    const codepro = data.codepro || "false";
    const withdraw_amount = data.withdraw_amount ? parseFloat(data.withdraw_amount) : null;
    const label = data.label || null;
    const unaccepted = data.unaccepted === "true";

    // Секретное слово для проверки уведомлений
    const notification_secret = Deno.env.get("NOTIFICATION_SECRET") || "";

    // Формируем строку для расчета хеша
    const hashString = `${notification_type}&${operation_id}&${amount}&${currency}&${datetime}&${sender}&${codepro}&${notification_secret}&${label || ""}`;

    // Вычисляем SHA-1 хеш
    const calculatedHash = await calculateSha1Hash(hashString);

    // Сравниваем рассчитанный хеш с полученным
    if (calculatedHash !== sha1_hash) {
      console.error("Хеш не совпадает, уведомление не подлинное.");
      return new Response("Хеш не совпадает", { status: 403 });
    }

    // Подключаемся к базе данных и сохраняем данные
    const connection = await pool.connect();
    try {
      const result = await connection.queryObject`
        INSERT INTO donations (
          amount, operation_id, sender, datetime,
          notification_type, withdraw_amount, label, sha1_hash, unaccepted
        )
        VALUES (
          ${amount}, ${operation_id}, ${sender}, ${datetime},
          ${notification_type}, ${withdraw_amount}, ${label}, ${sha1_hash}, ${unaccepted}
        )
      `;

      // Проверка результата вставки
      if (result.rowCount === 1) {
        console.log("Успешно добавлено в базу данных.");
        return new Response("Donation added successfully", { status: 200 });
      } else {
        console.error("Не удалось вставить данные в базу данных.");
        return new Response("Failed to add donation", { status: 500 });
      }
    } finally {
      // Освобождаем соединение обратно в пул
      connection.release();
    }
  } catch (err) {
    console.error("Ошибка при обработке запроса:", err);
    return new Response(`Ошибка сервера: ${err.message}`, { status: 500 });
  }
});