from rest_framework.authentication import SessionAuthentication as DRFSessionAuthentication
from rest_framework.request import Request


class SessionAuthentication(DRFSessionAuthentication):
    def authenticate_header(self, request: Request) -> str:
        return "Session"
