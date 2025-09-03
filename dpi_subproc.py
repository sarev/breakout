#!/usr/bin/env python3
#
# Windows-only helper used by the main game to obtain DPI-aware monitor geometry.
#
# This script runs as a separate process so it can set its own DPI awareness
# (`PROCESS_PER_MONITOR_DPI_AWARE`) without affecting the parent. It enumerates
# all connected displays via `EnumDisplayMonitors`, queries each display’s
# effective DPI with `GetDpiForMonitor`, and emits a JSON list to stdout.
#
# Each list item has the shape:
# {
#     "is_primary": bool,                     # True if this is the primary display
#     "monitor":   (left, top, right, bottom),# full monitor rect in physical pixels
#     "work_area": (left, top, right, bottom),# work area rect in physical pixels
#     "scaled":    (width, height),           # size converted to 96-DPI logical pixels
#     "dpi_scale": float                      # effective_dpi / 96.0
# }
#
# Intended usage:
#     - Spawn this script (e.g. `python dpi_subproc.py`) and parse stdout as JSON.
#     - Choose the primary monitor’s `"scaled"` size when creating the game window.
#
# Requirements and notes:
#     - Requires Windows 8.1 or later (for `GetDpiForMonitor` and
#       `SetProcessDpiAwareness` in shcore.dll).
#     - No third-party dependencies; uses `ctypes` to call Win32 APIs.
#     - Errors from Win32 calls are not wrapped here and will surface to the caller.
#
# Copyright (c) 2025, 7th software Ltd.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import ctypes
from ctypes import wintypes
import json


# Define necessary structures and constants
class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_ulong),
        ("rcMonitor", RECT),  # Monitor dimensions
        ("rcWork", RECT),     # Work area dimensions
        ("dwFlags", ctypes.c_ulong),  # Monitor flags
    ]


# Constants
MONITORINFOF_PRIMARY = 1
MDT_EFFECTIVE_DPI = 0  # DPI type for effective DPI
PROCESS_PER_MONITOR_DPI_AWARE = 2

# Load user32.dll and shcore.dll functions
user32 = ctypes.WinDLL("user32", use_last_error=True)
shcore = ctypes.WinDLL("shcore", use_last_error=True)

MonitorEnumProc = ctypes.WINFUNCTYPE(
    wintypes.BOOL,
    wintypes.HMONITOR,  # Monitor handle
    wintypes.HDC,       # Device context handle
    ctypes.POINTER(RECT),  # Monitor rectangle
    wintypes.LPARAM     # Application-defined data
)

# Callback to collect monitor information
monitor_list = []


def monitor_enum_proc(hMonitor, hdcMonitor, lprcMonitor, dwData):
    global monitor_list
    # Retrieve monitor info
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    user32.GetMonitorInfoW(hMonitor, ctypes.byref(mi))

    # Get DPI scale for the monitor
    dpi_x = ctypes.c_uint()
    dpi_y = ctypes.c_uint()
    shcore.GetDpiForMonitor(hMonitor, MDT_EFFECTIVE_DPI, ctypes.byref(dpi_x), ctypes.byref(dpi_y))

    # DPI scale factor
    dpi_scale = dpi_x.value / 96.0

    # Scaled monitor dimensions
    width = int((mi.rcMonitor.right - mi.rcMonitor.left) / dpi_scale)
    height = int((mi.rcMonitor.bottom - mi.rcMonitor.top) / dpi_scale)

    # Add monitor info to the list
    monitor_list.append({
        "is_primary": bool(mi.dwFlags & MONITORINFOF_PRIMARY),
        "monitor": (mi.rcMonitor.left, mi.rcMonitor.top, mi.rcMonitor.right, mi.rcMonitor.bottom),
        "scaled": (width, height),
        "work_area": (mi.rcWork.left, mi.rcWork.top, mi.rcWork.right, mi.rcWork.bottom),
        "dpi_scale": dpi_scale
    })
    return True


# Enumerate monitors
def enumerate_monitors():
    global monitor_list
    monitor_list.clear()
    user32.EnumDisplayMonitors(
        0,  # HDC (None means all displays)
        0,  # Clip rectangle (None means entire desktop)
        MonitorEnumProc(monitor_enum_proc),  # Callback function
        0,  # Application-defined data
    )
    return monitor_list


if __name__ == "__main__":  # pragma: no cover
    # Set DPI awareness
    shcore.SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE)

    # Enumerate monitors and print results as JSON
    monitors = enumerate_monitors()
    print(json.dumps(monitors))
