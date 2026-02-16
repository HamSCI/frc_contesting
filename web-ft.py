"""
HamSCI Contesting and DXing Dashboard - Backwards-Compatible Entry Point

This file exists so that existing deployment commands continue to work:
    python web-ft.py
    gunicorn -w 4 -b 0.0.0.0:5000 web-ft:app

For new code, import from app.py instead:
    from app import create_app

Author: Owen Ruzanski (KD3ALD)
Organization: University of Scranton (W3USR), Frankford Radio Club
Project: HamSCI Personal Space Weather Station Dashboard Development
"""

from app import create_app

app = create_app()

if __name__ == '__main__':
    app.run(debug=True)
