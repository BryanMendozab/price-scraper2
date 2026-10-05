import * as cheerio from 'cheerio';
import { config } from '../config.ts';
import { fetchText, parsePrice, round2, sleep, truncate } from '../utils.ts';
import type { Product } from '../../shared/types.ts';

const BASE = 'https://books.toscrape.com';
const PAGES = 2;
const PER_PAGE = 20;

/**
 * Libreria Anglo - books.toscrape.com
 *
 * Esta es la fuente que demuestra scraping HTML de verdad: hay que descargar
 * la pagina y extraer los datos del DOM con Cheerio.
 *   precio        -> article.product_pod p.price_color      ("£51.77")
 *   disponibilidad-> article.product_pod p.instock.availability
 *   ficha/url     -> article.product_pod h3 a
 *
 * El sitio existe justamente para practicar scraping, asi que es etico usarlo.
 */
export async function scrapeLiberiaAnglo(): Promise<Product[]> {
  const products: Product[] = [];

  for (let page = 1; page <= PAGES; page++) {
    const url = page === 1 ? `${BASE}/index.html` : `${BASE}/catalogue/page-${page}.html`;
    const html = await fetchText(url, config.requestTimeoutMs, config.userAgent);
    const $ = cheerio.load(html);

    $('article.product_pod').each((index, element) => {
      const node = $(element);
      const link = node.find('h3 a').first();
      const title = link.attr('title')?.trim() || link.text().trim();
      if (!title) return;

      const href = link.attr('href');
      const price = parsePrice(node.find('p.price_color').first().text());
      if (price === null) return;

      const availabilityText = node.find('p.availability').first().text();
      const inStock = /in stock/i.test(availabilityText);

      const imgSrc = node.find('div.image_container img').first().attr('src');

      products.push({
        id: `anglo-${page}-${index}`,
        title: truncate(title, 70),
        price: round2(price),
        currency: 'GBP',
        category: 'Libros',
        stock: inStock ? 1 : 0,
        availability: inStock ? 'in_stock' : 'out_of_stock',
        url: href ? new URL(href, `${BASE}/catalogue/`).href : null,
        image: imgSrc ? new URL(imgSrc, url).href : null,
        rating: null,
      });
    });

    // No golpeamos el sitio de corrido: dejamos respirar entre paginas.
    if (page < PAGES) await sleep(config.politenessDelayMs);
  }

  if (products.length === 0) throw new Error('No se encontro ningun producto en el HTML');
  return products;
}

export const ANGLO_EXPECTED_ITEMS = PAGES * PER_PAGE;
