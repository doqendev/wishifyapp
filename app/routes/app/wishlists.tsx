import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Text,
  Badge,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);

    // Get all wishlists for this shop
    const wishlists = await db.wishlist.findMany({
      where: {
        shop: session.shop,
      },
      include: {
        items: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Get customer details from Shopify for each wishlist
    const customerIds = wishlists.map(w => w.customerId);
    
    if (customerIds.length === 0) {
      return json({ wishlists: [] });
    }

    const customersQuery = `
      query getCustomers($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Customer {
            id
            firstName
            lastName
            email
            displayName
          }
        }
      }
    `;

    const customerGids = customerIds.map(id => `gid://shopify/Customer/${id}`);
    const response = await admin.graphql(customersQuery, {
      variables: { ids: customerGids }
    });

    const { data } = await response.json();
    
    // Combine wishlist data with customer data
    const enrichedWishlists = wishlists.map(wishlist => {
      const customer = data.nodes.find((c: any) => 
        c.id === `gid://shopify/Customer/${wishlist.customerId}`
      );
      
      return {
        id: wishlist.id,
        customerId: wishlist.customerId,
        customer: customer || null,
        itemCount: wishlist.items.length,
        createdAt: wishlist.createdAt,
        updatedAt: wishlist.updatedAt,
      };
    });

    return json({ wishlists: enrichedWishlists });
    
  } catch (error) {
    console.error("Error loading wishlists:", error);
    return json({ wishlists: [] });
  }
};

export default function WishlistsPage() {
  const { wishlists } = useLoaderData<typeof loader>();

  const rows = wishlists.map((wishlist) => [
    wishlist.customer?.displayName || wishlist.customer?.email || `Customer ${wishlist.customerId}`,
    wishlist.customer?.email || "N/A",
    wishlist.itemCount.toString(),
    new Date(wishlist.createdAt).toLocaleDateString(),
    new Date(wishlist.updatedAt).toLocaleDateString(),
    wishlist.itemCount > 0 ? (
      <Badge status="success">Active</Badge>
    ) : (
      <Badge>Empty</Badge>
    ),
  ]);

  return (
    <Page
      title="Customer Wishlists"
      subtitle="View and manage customer wishlists across your store"
    >
      <Layout>
        <Layout.Section>
          <Card>
            {wishlists.length > 0 ? (
              <DataTable
                columnContentTypes={[
                  'text',
                  'text',
                  'numeric',
                  'text',
                  'text',
                  'text',
                ]}
                headings={[
                  'Customer',
                  'Email',
                  'Items',
                  'Created',
                  'Last Updated',
                  'Status',
                ]}
                rows={rows}
              />
            ) : (
              <EmptyState
                heading="No wishlists yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p">
                  When customers start adding products to their wishlists, they'll appear here.
                </Text>
              </EmptyState>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
