#include <windows.h>
#include <delayimp.h>

#include <cstring>

namespace {
// Node's import library names node.exe, while Electron hosts the same stable
// Node-API exports in electron.exe. Resolve that one delayed import against
// the running host; never load a second Node executable into Electron.
FARPROC WINAPI resolve_host(unsigned int notification, DelayLoadInfo* import) {
  if (notification != dliNotePreLoadLibrary || _stricmp(import->szDll, "node.exe") != 0) return nullptr;
  HMODULE host = GetModuleHandleW(L"libnode.dll");
  if (!host) host = GetModuleHandleW(nullptr);
  return reinterpret_cast<FARPROC>(host);
}
}

decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2 = resolve_host;
