import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";

// Handle CORS for storefront requests
function addCorsHeaders(response: Response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Shop-Domain");
  response.headers.set("Access-Control-Allow-Credentials", "true");
  return response;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const productId = url.searchParams.get("productId");
  const shop = url.searchParams.get("shop") || request.headers.get("X-Shop-Domain");

  if (!shop) {
    const response = json({ error: "Shop domain is required" }, { status: 400 });
    return addCorsHeaders(response);
  }

  try {
    if (url.pathname.includes('/check')) {
      // Check if product is in wishlist
      if (!customerId || !productId) {
        const response = json({ inWishlist: false });
        return addCorsHeaders(response);
      }

      const wishlist = await db.wishlist.findUnique({
        where: {
          customerId_shop: {
            customerId,
            shop,
          },
        },
        include: {
          items: {
            where: {
              productId,
            },
          },
        },
      });

      const response = json({ inWishlist: !!(wishlist?.items.length) });
      return addCorsHeaders(response);    } else {
      // Get full wishlist with product data
      if (!customerId) {
        const response = json({ wishlist: null, items: [] });
        return addCorsHeaders(response);
      }

      const wishlist = await db.wishlist.findUnique({
        where: {
          customerId_shop: {
            customerId,
            shop,
          },
        },
        include: {
          items: {
            orderBy: {
              addedAt: 'desc',
            },
          },
        },
      });

      if (!wishlist) {
        const response = json({ wishlist: null, items: [] });
        return addCorsHeaders(response);
      }

      // Fetch product data from Shopify for each wishlist item
      const itemsWithProductData = await Promise.all(
        wishlist.items.map(async (item) => {
          try {
            // For now, we'll return basic product info
            // In a real implementation, you'd fetch from Shopify's Storefront API
            return {
              id: item.id,
              productId: item.productId,
              variantId: item.variantId,
              addedAt: item.addedAt,
              product: {
                id: item.productId,
                title: `Product ${item.productId}`, // This would come from Shopify API
                handle: `product-${item.productId}`,
                featured_image: `/assets/placeholder.png`,
                price: 2999, // This would come from Shopify API
                variants: item.variantId ? [{
                  id: item.variantId,
                  title: 'Default Title',
                  price: 2999,
                  available: true
                }] : []
              }
            };
          } catch (error) {
            console.error(`Error fetching product data for ${item.productId}:`, error);
            return null;
          }
        })
      );

      const validItems = itemsWithProductData.filter(item => item !== null);

      const response = json({ 
        wishlist: {
          id: wishlist.id,
          customerId: wishlist.customerId,
          shop: wishlist.shop,
          items: validItems
        }
      });
      return addCorsHeaders(response);
    }
  } catch (error) {
    console.error("Error in storefront wishlist loader:", error);
    const response = json({ error: "Internal server error" }, { status: 500 });
    return addCorsHeaders(response);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const method = request.method;
  const body = await request.json();
  const { customerId, productId, variantId, shop } = body;

  if (!customerId || !productId || !shop) {
    const response = json({ error: "Missing required fields" }, { status: 400 });
    return addCorsHeaders(response);
  }

  try {
    if (method === "POST") {
      // Add to wishlist
      const wishlist = await db.wishlist.upsert({
        where: {
          customerId_shop: {
            customerId,
            shop,
          },
        },
        update: {},
        create: {
          customerId,
          shop,
        },
      });

      await db.wishlistItem.upsert({
        where: {
          wishlistId_productId_variantId: {
            wishlistId: wishlist.id,
            productId,
            variantId: variantId || '',
          },
        },
        update: {},
        create: {
          wishlistId: wishlist.id,
          productId,
          variantId,
        },
      });

      const response = json({ success: true, message: "Added to wishlist" });
      return addCorsHeaders(response);

    } else if (method === "DELETE") {
      // Remove from wishlist
      const wishlist = await db.wishlist.findUnique({
        where: {
          customerId_shop: {
            customerId,
            shop,
          },
        },
      });

      if (wishlist) {
        await db.wishlistItem.deleteMany({
          where: {
            wishlistId: wishlist.id,
            productId,
          },
        });
      }

      const response = json({ success: true, message: "Removed from wishlist" });
      return addCorsHeaders(response);
    }

    const response = json({ error: "Method not allowed" }, { status: 405 });
    return addCorsHeaders(response);

  } catch (error) {
    console.error("Error in storefront wishlist action:", error);
    const response = json({ error: "Internal server error" }, { status: 500 });
    return addCorsHeaders(response);
  }
}
