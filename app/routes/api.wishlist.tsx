import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const customerId = url.searchParams.get("customerId");
    
    if (!customerId) {
      return json({ error: "Customer ID is required" }, { status: 400 });
    }

    // Get customer's wishlist
    const wishlist = await db.wishlist.findUnique({
      where: {
        customerId_shop: {
          customerId: customerId,
          shop: session.shop,
        },
      },
      include: {
        items: true,
      },
    });

    if (!wishlist) {
      return json({ items: [] });
    }

    // Fetch product details from Shopify
    const productIds = wishlist.items.map(item => `gid://shopify/Product/${item.productId}`);
    
    if (productIds.length === 0) {
      return json({ items: [] });
    }

    const productsQuery = `
      query getProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            featuredImage {
              url
              altText
            }
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            variants(first: 250) {
              edges {
                node {
                  id
                  title
                  price {
                    amount
                    currencyCode
                  }
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await admin.graphql(productsQuery, {
      variables: { ids: productIds }
    });

    const { data } = await response.json();
    
    // Combine wishlist items with product data
    const enrichedItems = wishlist.items.map(item => {
      const product = data.nodes.find((p: any) => p.id === `gid://shopify/Product/${item.productId}`);
      const variant = product?.variants.edges.find((v: any) => 
        v.node.id === `gid://shopify/ProductVariant/${item.variantId}`
      );
      
      return {
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        addedAt: item.addedAt,
        product: product ? {
          id: product.id,
          title: product.title,
          handle: product.handle,
          image: product.featuredImage,
          priceRange: product.priceRangeV2,
        } : null,
        variant: variant ? variant.node : null,
      };
    });

    return json({ items: enrichedItems });
    
  } catch (error) {
    console.error("Error fetching wishlist:", error);
    return json({ error: "Failed to fetch wishlist" }, { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const method = formData.get("_method") as string;
    
    switch (method) {
      case "POST": {
        // Add item to wishlist
        const customerId = formData.get("customerId") as string;
        const productId = formData.get("productId") as string;
        const variantId = formData.get("variantId") as string;

        if (!customerId || !productId) {
          return json({ error: "Customer ID and Product ID are required" }, { status: 400 });
        }

        // Find or create wishlist
        let wishlist = await db.wishlist.findUnique({
          where: {
            customerId_shop: {
              customerId: customerId,
              shop: session.shop,
            },
          },
        });

        if (!wishlist) {
          wishlist = await db.wishlist.create({
            data: {
              customerId: customerId,
              shop: session.shop,
            },
          });
        }

        // Add item to wishlist (or update if exists)
        const existingItem = await db.wishlistItem.findUnique({
          where: {
            wishlistId_productId_variantId: {
              wishlistId: wishlist.id,
              productId: productId,
              variantId: variantId || null,
            },
          },
        });

        if (existingItem) {
          return json({ message: "Item already in wishlist", itemId: existingItem.id });
        }

        const newItem = await db.wishlistItem.create({
          data: {
            wishlistId: wishlist.id,
            productId: productId,
            variantId: variantId || null,
          },
        });

        return json({ message: "Item added to wishlist", itemId: newItem.id });
      }

      case "DELETE": {
        // Remove item from wishlist
        const itemId = formData.get("itemId") as string;
        const customerId = formData.get("customerId") as string;

        if (!itemId || !customerId) {
          return json({ error: "Item ID and Customer ID are required" }, { status: 400 });
        }

        // Verify the item belongs to the customer's wishlist
        const item = await db.wishlistItem.findFirst({
          where: {
            id: itemId,
            wishlist: {
              customerId: customerId,
              shop: session.shop,
            },
          },
        });

        if (!item) {
          return json({ error: "Item not found" }, { status: 404 });
        }

        await db.wishlistItem.delete({
          where: { id: itemId },
        });

        return json({ message: "Item removed from wishlist" });
      }

      default:
        return json({ error: "Method not allowed" }, { status: 405 });
    }
  } catch (error) {
    console.error("Error handling wishlist action:", error);
    return json({ error: "Failed to process request" }, { status: 500 });
  }
};
