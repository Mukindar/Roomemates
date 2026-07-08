import { createClient } from '@supabase/supabase-js';

const getInitialConfig = () => {
    const envUrl = import.meta.env.VITE_SUPABASE_URL;
    const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    // Utilize env configuration if both are populated and not default templates
    if (envUrl && envUrl !== 'your_supabase_url' && envKey && envKey !== 'your_anon_key') {
        return { url: envUrl, key: envKey };
    }

    // Fallback to project default credentials
    const defaultUrl = 'https://kkqljmupclhzrtqdqeus.supabase.co';
    const defaultKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrcWxqbXVwY2xoenJ0cWRxZXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjgzNzMsImV4cCI6MjA5OTAwNDM3M30.goWi9HusnyiJNiF7hZfyBrdduYEheIf2ulNigj5aIbE';

    // Fallback to local storage configuration
    const localUrl = localStorage.getItem('ROOMEMATES_SUPABASE_URL');
    const localKey = localStorage.getItem('ROOMEMATES_SUPABASE_KEY');

    return { url: localUrl || defaultUrl, key: localKey || defaultKey };
};

const config = getInitialConfig();

export let supabase = null;

if (config.url && config.key) {
    try {
        supabase = createClient(config.url, config.key);
    } catch (err) {
        console.error('Failed to initialize Supabase client:', err);
    }
}

/**
 * Dynamically initialises Supabase client and caches the configs.
 */
export const setupSupabaseClient = (url, key) => {
    if (!url || !key) return false;
    try {
        supabase = createClient(url, key);
        localStorage.setItem('ROOMEMATES_SUPABASE_URL', url);
        localStorage.setItem('ROOMEMATES_SUPABASE_KEY', key);
        return true;
    } catch (err) {
        console.error('Error sets up Supabase client:', err);
        return false;
    }
};

/**
 * Resets local storage keys and destroys the instance.
 */
export const clearSupabaseClient = () => {
    supabase = null;
    localStorage.removeItem('ROOMEMATES_SUPABASE_URL');
    localStorage.removeItem('ROOMEMATES_SUPABASE_KEY');
};
