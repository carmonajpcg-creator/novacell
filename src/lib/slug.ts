/** Convierte un nombre en un slug válido para la base de datos: ^[a-z0-9]+(-[a-z0-9]+)*$ */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
