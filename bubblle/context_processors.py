from django.conf import settings


def client_version(request):
    return {"BUBBLLE_CLIENT_VERSION": getattr(settings, "BUBBLLE_CLIENT_VERSION", "2")}
