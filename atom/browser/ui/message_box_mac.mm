// Copyright (c) 2013 GitHub, Inc.
// Use of this source code is governed by the MIT license that can be
// found in the LICENSE file.

#include "atom/browser/ui/message_box.h"

#import <Cocoa/Cocoa.h>

#include "atom/browser/native_window.h"
#include "base/callback.h"
#include "base/mac/mac_util.h"
#include "base/strings/sys_string_conversions.h"
#include "skia/ext/skia_utils_mac.h"
#include "ui/gfx/image/image_skia.h"

namespace atom {

namespace {

NSAlert* CreateNSAlert(NativeWindow* parent_window,
                       MessageBoxType type,
                       const std::vector<std::string>& buttons,
                       int default_id,
                       int cancel_id,
                       const std::string& title,
                       const std::string& message,
                       const std::string& detail,
                       const std::string& checkbox_label,
                       bool checkbox_checked,
                       const gfx::ImageSkia& icon) {
  // Ignore the title; it's the window title on other platforms and ignorable.
  NSAlert* alert = [[NSAlert alloc] init];
  [alert setMessageText:base::SysUTF8ToNSString(message)];
  [alert setInformativeText:base::SysUTF8ToNSString(detail)];

  switch (type) {
    case MESSAGE_BOX_TYPE_INFORMATION:
      alert.alertStyle = NSInformationalAlertStyle;
      break;
    case MESSAGE_BOX_TYPE_WARNING:
    case MESSAGE_BOX_TYPE_ERROR:
      // NSWarningAlertStyle shows the app icon while NSCriticalAlertStyle
      // shows a warning icon with an app icon badge. Since there is no
      // error variant, lets just use NSCriticalAlertStyle.
      alert.alertStyle = NSCriticalAlertStyle;
      break;
    default:
      break;
  }

  for (size_t i = 0; i < buttons.size(); ++i) {
    NSString* title = base::SysUTF8ToNSString(buttons[i]);
    // An empty title causes crash on macOS.
    if (buttons[i].empty())
      title = @"(empty)";
    NSButton* button = [alert addButtonWithTitle:title];
    [button setTag:i];
  }

  NSArray* ns_buttons = [alert buttons];
  int button_count = static_cast<int>([ns_buttons count]);

  if (default_id >= 0 && default_id < button_count) {
    // Highlight the button at default_id
    [[ns_buttons objectAtIndex:default_id] highlight:YES];

    // The first button added gets set as the default selected.
    // So remove that default, and make the requested button the default.
    [[ns_buttons objectAtIndex:0] setKeyEquivalent:@""];
    [[ns_buttons objectAtIndex:default_id] setKeyEquivalent:@"\r"];
  }

  // Bind cancel id button to escape key if there is more than one button
  if (button_count > 1 && cancel_id >= 0 && cancel_id < button_count) {
    [[ns_buttons objectAtIndex:cancel_id] setKeyEquivalent:@"\e"];
  }

  if (!checkbox_label.empty()) {
    alert.showsSuppressionButton = YES;
    alert.suppressionButton.title = base::SysUTF8ToNSString(checkbox_label);
    alert.suppressionButton.state = checkbox_checked ? NSOnState : NSOffState;
  }

  if (!icon.isNull()) {
    NSImage* image = skia::SkBitmapToNSImageWithColorSpace(
        *icon.bitmap(), base::mac::GetGenericRGBColorSpace());
    [alert setIcon:image];
  }

  return alert;
}

}  // namespace

int ShowMessageBoxSync(NativeWindow* parent_window,
                       MessageBoxType type,
                       const std::vector<std::string>& buttons,
                       int default_id,
                       int cancel_id,
                       int options,
                       const std::string& title,
                       const std::string& message,
                       const std::string& detail,
                       const gfx::ImageSkia& icon) {
  NSAlert* alert =
      CreateNSAlert(parent_window, type, buttons, default_id, cancel_id, title,
                    message, detail, "", false, icon);

  // Use runModal for synchronous alert without parent, since we don't have a
  // window to wait for.
  if (!parent_window)
    return [[alert autorelease] runModal];

  __block int ret_code = -1;

  NSWindow* window = parent_window->GetNativeWindow().GetNativeNSWindow();
  [alert beginSheetModalForWindow:window
                completionHandler:^(NSModalResponse response) {
                  ret_code = response;
                  [NSApp stopModal];
                }];

  [NSApp runModalForWindow:window];
  return ret_code;
}

void ShowMessageBox(NativeWindow* parent_window,
                    MessageBoxType type,
                    const std::vector<std::string>& buttons,
                    int default_id,
                    int cancel_id,
                    int options,
                    const std::string& title,
                    const std::string& message,
                    const std::string& detail,
                    const std::string& checkbox_label,
                    bool checkbox_checked,
                    const gfx::ImageSkia& icon,
                    MessageBoxCallback callback) {
  NSAlert* alert =
      CreateNSAlert(parent_window, type, buttons, default_id, cancel_id, title,
                    message, detail, checkbox_label, checkbox_checked, icon);

  // Use runModal for synchronous alert without parent, since we don't have a
  // window to wait for.
  if (!parent_window) {
    int ret = [[alert autorelease] runModal];
    std::move(callback).Run(ret, alert.suppressionButton.state == NSOnState);
  } else {
    NSWindow* window =
        parent_window ? parent_window->GetNativeWindow().GetNativeNSWindow()
                      : nil;

    // Duplicate the callback object here since c is a reference and gcd would
    // only store the pointer, by duplication we can force gcd to store a copy.
    __block MessageBoxCallback callback_ = std::move(callback);

    [alert beginSheetModalForWindow:window
                  completionHandler:^(NSModalResponse response) {
                    std::move(callback_).Run(
                        response, alert.suppressionButton.state == NSOnState);
                  }];
  }
}

void ShowErrorBox(const base::string16& title, const base::string16& content) {
  NSAlert* alert = [[NSAlert alloc] init];
  [alert setMessageText:base::SysUTF16ToNSString(title)];
  [alert setInformativeText:base::SysUTF16ToNSString(content)];
  [alert setAlertStyle:NSCriticalAlertStyle];
  [alert runModal];
  [alert release];
}

}  // namespace atom
