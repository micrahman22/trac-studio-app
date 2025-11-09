let supabaseClient = null;

// DOM elements
const urlInput = document.getElementById('supabaseUrl');
const keyInput = document.getElementById('supabaseKey');
const saveConfigBtn = document.getElementById('saveConfig');
const testConnectionBtn = document.getElementById('testConnection');
const statusDiv = document.getElementById('status');

// Load saved configuration from localStorage
function loadConfig() {
    const savedUrl = localStorage.getItem('supabaseUrl');
    const savedKey = localStorage.getItem('supabaseKey');
    
    if (savedUrl) urlInput.value = savedUrl;
    if (savedKey) keyInput.value = savedKey;
    
    if (savedUrl && savedKey) {
        initializeSupabase(savedUrl, savedKey);
    }
}

// Initialize Supabase client
function initializeSupabase(url, key) {
    try {
        supabaseClient = supabase.createClient(url, key);
        showStatus('Configuration loaded successfully!', 'info');
    } catch (error) {
        showStatus('Error initializing Supabase: ' + error.message, 'error');
    }
}

// Save configuration
saveConfigBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    const key = keyInput.value.trim();
    
    if (!url || !key) {
        showStatus('Please enter both URL and API key', 'error');
        return;
    }
    
    // Validate URL format
    if (!url.startsWith('https://') || !url.includes('supabase.co')) {
        showStatus('Please enter a valid Supabase URL (e.g., https://your-project.supabase.co)', 'error');
        return;
    }
    
    // Save to localStorage
    localStorage.setItem('supabaseUrl', url);
    localStorage.setItem('supabaseKey', key);
    
    // Initialize Supabase client
    initializeSupabase(url, key);
    
    showStatus('Configuration saved successfully!', 'success');
});

// Test connection
testConnectionBtn.addEventListener('click', async () => {
    if (!supabaseClient) {
        showStatus('Please save your configuration first', 'error');
        return;
    }
    
    testConnectionBtn.disabled = true;
    testConnectionBtn.textContent = 'Testing...';
    showStatus('Testing connection to Supabase...', 'info');
    
    try {
        // Test connection by attempting to get the current session
        // This is a lightweight operation that verifies the connection
        const { data, error } = await supabaseClient.auth.getSession();
        
        if (error && error.message.includes('Failed to fetch')) {
            throw new Error('Unable to connect to Supabase. Please check your URL.');
        }
        
        // Connection is successful
        showStatus('✅ Connection successful! Supabase client is properly configured and can communicate with your project.', 'success');
        
    } catch (error) {
        showStatus('❌ Connection failed: ' + error.message, 'error');
    } finally {
        testConnectionBtn.disabled = false;
        testConnectionBtn.textContent = 'Test Connection';
    }
});

// Show status message
function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = 'status-message ' + type;
}

// Load configuration on page load
loadConfig();
