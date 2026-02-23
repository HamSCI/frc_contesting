"""
Amateur radio band utilities.

Converts frequencies to standard band designations used in
amateur radio contesting and DXing.
"""


def frequency_to_band(freq):
    """
    Convert a frequency in MHz to an amateur radio band designation.

    Maps frequencies to standard amateur radio band names based on FCC amateur
    radio frequency allocations. Used to categorize spots by band for display
    and filtering purposes.

    Args:
        freq (float): Frequency in MHz (e.g., 14.097 for 20 meters)

    Returns:
        str: Band designation (e.g., "20m", "40m") or "Unknown" if not in an amateur band

    Example:
        >>> frequency_to_band(14.097)
        '20m'
        >>> frequency_to_band(7.074)
        '40m'
    """
    if freq is None:
        return "Unknown"

    # Long wave bands
    if 0.136 <= freq < 0.137:
        return "2200m"
    if 0.472 <= freq < 0.479:
        return "630m"

    # HF bands (most commonly used for DX and contesting)
    if 1.8 <= freq < 2:
        return "160m"
    if 3.5 <= freq < 4:
        return "80m"
    if 5.2 <= freq < 5.5:
        return "60m"
    if 7.0 <= freq < 7.3:
        return "40m"
    if 10.1 <= freq < 10.15:
        return "30m"  # WARC band (no contests)
    if 14.0 <= freq < 14.35:
        return "20m"
    if 18.068 <= freq < 18.168:
        return "17m"  # WARC band (no contests)
    if 21.0 <= freq < 21.45:
        return "15m"
    if 24.89 <= freq < 24.99:
        return "12m"  # WARC band (no contests)
    if 28.0 <= freq < 29.7:
        return "10m"

    # VHF/UHF bands
    if 50.0 <= freq < 54.0:
        return "6m"
    if 144.0 <= freq < 148.0:
        return "2m"

    return "Unknown"
