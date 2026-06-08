import type { CartMergeResult } from '@app/shared';

/**
 * zh-Hant copy for cart-related user feedback. Centralized so the drawer,
 * AddToCart button, and merge toast share the same voice.
 */

export function mergeToastMessage(result: CartMergeResult): string | null {
  const t = result.truncatedItems.length;
  const d = result.droppedItems.length;
  if (t === 0 && d === 0) return null;
  const parts: string[] = [];
  if (t > 0) parts.push(`${t} 件商品已達庫存上限`);
  if (d > 0) parts.push(`${d} 件商品已下架`);
  return `合併購物車：${parts.join('，')}`;
}

interface ApiError {
  code: string;
  message: string;
  details?: { available?: number };
}

/**
 * Translate the structured API error from POST/PATCH /cart/items into a
 * single line of zh-Hant. Falls back to the API's own message (already
 * zh-Hant in this codebase) for any code we haven't mapped.
 */
export function cartApiErrorMessage(err: ApiError | null): string {
  if (!err) return '操作失敗，請稍後再試';
  switch (err.code) {
    case 'OUT_OF_STOCK':
      return typeof err.details?.available === 'number'
        ? `庫存不足：目前僅剩 ${err.details.available} 件`
        : '庫存不足';
    case 'SKU_INACTIVE':
      return '此商品已下架';
    case 'SKU_NOT_FOUND':
      return '找不到此商品規格';
    case 'CART_ITEM_NOT_FOUND':
      return '購物車項目不存在';
    case 'VALIDATION_ERROR':
      return '輸入格式錯誤';
    default:
      return err.message || '操作失敗，請稍後再試';
  }
}
