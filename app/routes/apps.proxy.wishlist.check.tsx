import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";

// Handle CORS for storefront requests
function addCorsHeaders(response: Response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Shop-Domain");
  response.headers.set("Access-Control-Allow-Credentials", "true");
  return response;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const productId = url.searchParams.get("productId");
  const shop = url.searchParams.get("shop");

  if (!shop || !customerId || !productId) {
    const response = json({ inWishlist: false });
    return addCorsHeaders(response);
  }

  try {
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
    return addCorsHeaders(response);
  } catch (error) {
    console.error("Error checking wishlist status:", error);
    const response = json({ inWishlist: false });
    return addCorsHeaders(response);
  }
}
