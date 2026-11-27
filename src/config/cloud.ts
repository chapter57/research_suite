// Cloud storage settings. The publishable key is designed to be public: the
// database's security rules (supabase/schema.sql) decide what it can reach.
export const cloud = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sgfdlgbnnrrtvwcdbbef.supabase.co",
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_H23_BTKIFR219lJC1gufXA_CyHtq9ow",
};
