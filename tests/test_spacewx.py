"""services/spacewx.py (#73): SWPC parsing and the offline behaviour, no network."""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from services import spacewx as sw  # noqa: E402


def test_scales():
    assert sw.xray_class(2.1e-5) == 'M2.1' and sw.xray_class(3e-7) == 'B3.0' and sw.xray_class(1.2e-4) == 'X1.2'
    assert sw.xray_class(None) is None
    assert sw.g_scale(4.67) == 0 and sw.g_scale(5.0) == 1 and sw.g_scale(9) == 5
    assert sw.s_scale(0.2) == 0 and sw.s_scale(15) == 1 and sw.s_scale(150) == 2


def test_offline_summary_is_safe(tmp_path, monkeypatch):
    w = sw.SpaceWeather(cache=str(tmp_path / 'c.json'))

    def offline(path):
        raise OSError('Network is unreachable')
    monkeypatch.setattr(w, '_get', offline)
    w.refresh(force=True)
    s = w.summary()
    assert s['enabled'] and 'xray' not in s and len(s['errors']) == len(sw.PRODUCTS)


def test_disabled():
    assert sw.SpaceWeather(enabled=False).summary() == {'enabled': False}


def test_summary_from_cache(tmp_path):
    now = sw._now()

    def iso(ago):
        return datetime.fromtimestamp(now - ago, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    raw = {'xray': [[iso(60), 1.5e-6], [iso(0), 2.2e-5]], 'protons': [[iso(0), 12.0]],
           'kp3h': [[iso(3600), 3.33]], 'kp1m': [[iso(0), 5.0]],
           'speed': [{'proton_speed': 450, 'time_tag': iso(0)}],
           'mag': [{'bt': 8, 'bz_gsm': -6, 'time_tag': iso(0)}],
           'plasma': [[iso(0), 4.2]], 'f107': [{'flux': 131, 'time_tag': iso(0)}],
           'scales': {'0': {'DateStamp': '2026-11-16', 'TimeStamp': '04:58:00',
                            'R': {'Scale': '2', 'Text': 'moderate'}, 'S': {'Scale': '1', 'Text': 'minor'},
                            'G': {'Scale': '0', 'Text': 'none'}}},
           'alerts': [[iso(100).replace('T', ' ').rstrip('Z'), 'A20F', 'Watch: Geomagnetic Storm Category G1 Predicted']]}
    cache = tmp_path / 'c.json'
    cache.write_text(json.dumps({'raw': raw, 'fetched': {k: now for k in sw.PRODUCTS}, 'errors': {}, 'history': {}}))
    s = sw.SpaceWeather(cache=str(cache)).summary()
    assert s['xray']['class'] == 'M2.2' and s['xray']['peak6h'] == 'M2.2'
    assert s['protons']['s'] == 1 and s['kp']['g'] == 1 and s['kp']['est'] == 5.0
    assert s['wind']['speed'] == 450 and s['wind']['density'] == 4.2
    assert s['imf']['bz'] == -6 and s['f107']['flux'] == 131 and s['scales']['R']['scale'] == 2
    assert s['alerts'][0]['headline'].startswith('Watch: Geomagnetic')


def test_alert_headlines():
    msgs = [
        'Space Weather Message Code: WATA20\r\nSerial Number: 1138\r\n\r\nWATCH: Geomagnetic Storm Category G1 Predicted\nHighest',
        'Space Weather Message Code: ALTEF3\r\nSerial Number: 3776\r\n\r\nCONTINUED ALERT: Electron 2MeV Integral Flux exceeded 1,000pfu\nMore',
    ]
    out = sw.SpaceWeather._trim('alerts', [{'issue_datetime': '2026-11-15 13:34:32.160', 'product_id': 'X', 'message': m}
                                           for m in msgs])
    assert [o[2] for o in out] == ['Watch: Geomagnetic Storm Category G1 Predicted',
                                   'Continued Alert: Electron 2MeV Integral Flux exceeded 1,000pfu']
