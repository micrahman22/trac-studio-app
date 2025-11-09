# Supabase Connection Test Website

## Overview
A simple, clean HTML website that allows users to connect to Supabase and test their connection. The site features a modern UI with configuration management and visual feedback for connection testing.

## Project Structure
```
├── index.html      # Main HTML page
├── style.css       # Styling and layout
└── script.js       # JavaScript for Supabase integration
```

## Features
- **Configuration Management**: Save and load Supabase URL and API key using localStorage
- **Connection Testing**: Test button to verify Supabase connectivity
- **Visual Feedback**: Color-coded status messages (success/error/info)
- **Modern UI**: Clean, responsive design with gradient backgrounds
- **Separate Files**: HTML, CSS, and JavaScript properly organized

## Technology Stack
- Vanilla HTML, CSS, JavaScript
- Supabase JavaScript Client (v2, loaded via CDN)
- LocalStorage for configuration persistence

## Setup Instructions
1. Get your Supabase project URL and anon/public API key from your Supabase dashboard
2. Enter the credentials in the configuration section
3. Click "Save Configuration"
4. Click "Test Connection" to verify the setup

## Recent Changes
- 2025-11-09: Initial project creation with all core features

## Architecture
- **Frontend Only**: No backend server required
- **Static Site**: Can be served with any simple HTTP server
- **Client-Side Storage**: Configuration stored in browser localStorage
- **CDN Dependencies**: Supabase client loaded from jsDelivr CDN
