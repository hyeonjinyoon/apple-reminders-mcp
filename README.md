# reminders-mcp-server

macOS iCloud 미리 알림을 Claude Code에서 사용할 수 있게 해주는 MCP 서버입니다.
AppleScript를 통해 Reminders.app에 접근합니다.

## 제공 도구

| 도구 | 설명 |
|------|------|
| `reminders_list_lists` | 모든 미리 알림 목록 조회 |
| `reminders_list_items` | 특정 목록의 미리 알림 조회 |
| `reminders_create` | 미리 알림 생성 (기한, 우선순위, 플래그 지원) |
| `reminders_complete` | 미리 알림 완료 처리 |
| `reminders_delete` | 미리 알림 삭제 |
| `reminders_search` | 전체 목록에서 키워드 검색 |

## 설치

```bash
cd reminders-mcp-server
npm install
npm run build
```

## macOS 권한 설정

처음 실행 시 "Reminders" 앱 접근 권한을 요청하는 다이얼로그가 뜹니다.
허용해야 정상 동작합니다.

수동으로 설정하려면:
**시스템 설정 → 개인정보 보호 및 보안 → 자동화**에서
실행 주체(Terminal 또는 Node)가 **미리 알림**에 접근할 수 있도록 허용해 주세요.

## Claude Code 설정

`~/.claude/claude_code_config.json` 또는 프로젝트의 `.mcp.json`에 추가:

```json
{
  "mcpServers": {
    "reminders": {
      "command": "node",
      "args": ["/absolute/path/to/reminders-mcp-server/dist/index.js"]
    }
  }
}
```

예를 들어 홈 디렉토리에 설치했다면:

```json
{
  "mcpServers": {
    "reminders": {
      "command": "node",
      "args": ["/Users/yourname/reminders-mcp-server/dist/index.js"]
    }
  }
}
```

## 사용 예시

Claude Code에서:

- "미리 알림 목록 보여줘"
- "'할 일' 목록에서 미완료 항목 조회해줘"
- "'할 일' 목록에 '우유 사기' 추가해줘, 내일까지"
- "'우유 사기' 완료 처리해줘"
- "미리 알림에서 '회의' 검색해줘"

## 주의사항

- macOS에서만 동작합니다 (AppleScript 의존)
- Reminders.app이 iCloud에 연결되어 있으면 iCloud 미리 알림에도 접근됩니다
- 미리 알림이 많은 목록에서는 조회가 느릴 수 있습니다
- AppleScript의 한계로 인해 서브태스크(하위 항목)는 별도 조회가 어렵습니다
