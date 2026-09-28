// Link de click-to-chat do WhatsApp: wa.me aceita só dígitos no
// caminho e a mensagem em ?text= (URL-encoded).
export function buildWaMeUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
