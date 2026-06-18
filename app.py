from flask import Flask, send_from_directory
import os

# Initialize Flask app, telling it where the static files are
app = Flask(__name__, static_folder='static')

@app.route('/')
def serve_index():
    """Serve the main index.html file from the root directory."""
    return send_from_directory('.', 'index.html')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
