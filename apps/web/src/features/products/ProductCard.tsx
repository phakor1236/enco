import { Link } from 'react-router-dom';
import type { ProductListItemDto } from '@app/shared';

import { formatMoney } from './format.js';

interface ProductCardProps {
  product: ProductListItemDto;
}

export function ProductCard({ product }: ProductCardProps): JSX.Element {
  return (
    <Link
      to={`/product/${product.slug}`}
      className="group flex flex-col rounded-lg border border-line bg-surface overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="aspect-square bg-paper-2 overflow-hidden">
        {product.primaryImage ? (
          <img
            src={product.primaryImage.url}
            alt={product.primaryImage.alt ?? product.name}
            loading="lazy"
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-ink-faint">
            no image
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wide text-ink-soft">{product.category.name}</div>
        <div className="font-semibold text-ink leading-snug line-clamp-2">{product.name}</div>
        <div className="mt-1 font-display text-lg text-ink">{formatMoney(product.basePrice)}</div>
      </div>
    </Link>
  );
}
