"""Unit tests for sink → wspr_db.spots translation (payloads captured on W3USR-06)."""

from datetime import datetime, timezone

from frc_spot_store.translate import (frequency_to_band, normalize_callsign,
                                      normalize_grid, translate)

ALL = {'wspr', 'ft8', 'ft4'}

WSPR = {"time": "2026-10-08T04:46:00Z", "band": "40", "mode": "W2",
        "radiod_id": "W3USR-06-status.local", "reporter_id": "W3USR/06",
        "frequency_hz": 7040195, "callsign": "N3FXU", "grid": "FN11", "snr_db": -22,
        "dt": -0.4, "drift_hz_per_s": 0.0166666666666667, "pwr_dbm": 23,
        "sync_quality": 0.25, "decoder_kind": "wsprd", "decodetype": 0,
        "rx_call": "W3USR/06", "schema_version": 2}

FT8 = {"time": "2026-10-08T04:48:30+00:00", "mode": "ft8", "decoder_kind": "decode_ft8",
       "score": 32, "snr_db": None, "dt": -0.41000000000000003, "frequency": 10139512,
       "message": "RA5AD N1UL EL95", "tx_call": "N1UL", "rx_call": "RA5AD", "grid": "EL95",
       "reporter_id": "W3USR/06", "radiod_id": "W3USR-06-status.local"}


def test_wspr_maps_to_dashboard_schema():
    doc, why = translate('wspr', WSPR, rx_callsign='W3USR/06', modes=ALL)
    assert why == 'ok'
    assert doc['callsign'] == 'N3FXU'
    assert doc['rx_callsign'] == 'W3USR/06'
    assert doc['grid'] == 'FN11'
    assert doc['frequency'] == 7.040195
    assert doc['band'] == '40m'
    assert doc['mode'] == 'wspr'
    assert doc['date'] == '261008' and doc['time'] == '0446'
    assert doc['snr'] == -22
    assert doc['drift'] == 1              # 1/60 Hz/s → 1 Hz/min
    assert doc['power'] == 23
    assert doc['dt'] == -0.4 and doc['sync'] == 0.25
    assert doc['ts'] == datetime(2026, 10, 8, 4, 46, tzinfo=timezone.utc)
    assert doc['spot_key'] == 'wspr|20261008T044600|N3FXU|40m'


def test_ft8_uses_tx_call_not_message_addressee():
    doc, why = translate('psk', FT8, rx_callsign='W3USR/06', modes=ALL)
    assert why == 'ok'
    assert doc['callsign'] == 'N1UL'
    assert doc['rx_callsign'] == 'W3USR/06'
    assert doc['mode'] == 'ft8' and doc['band'] == '30m'
    assert doc['snr'] is None and doc['score'] == 32
    assert doc['dt'] == -0.41
    assert doc['time'] == '0448'


def test_skips_rows_the_dashboard_cannot_place():
    assert translate('psk', {**FT8, 'grid': 'RR73'}, rx_callsign='x', modes=ALL)[1] == 'no_grid'
    assert translate('psk', {**FT8, 'grid': ''}, rx_callsign='x', modes=ALL)[1] == 'no_grid'
    assert translate('wspr', {**WSPR, 'callsign': '<...>'}, rx_callsign='x', modes=ALL)[1] == 'no_callsign'
    assert translate('psk', {**FT8, 'mode': 'msk144'}, rx_callsign='x', modes=ALL)[1] == 'mode_unsupported'
    assert translate('wspr', {**WSPR, 'mode': 'F2'}, rx_callsign='x', modes=ALL)[1] == 'mode_unsupported'
    assert translate('psk', FT8, rx_callsign='x', modes={'wspr'})[1] == 'mode_disabled'
    assert translate('wspr', {**WSPR, 'time': 'garbage'}, rx_callsign='x', modes=ALL)[1] == 'bad_time'


def test_helpers():
    assert normalize_grid('fn42HX') == 'FN42hx'
    assert normalize_grid('FN4') is None
    assert normalize_grid('ZZ00') is None
    assert normalize_callsign('<W1AW>') == 'W1AW'
    assert frequency_to_band(50.318) == '6m'
    assert frequency_to_band(None) == 'Unknown'
